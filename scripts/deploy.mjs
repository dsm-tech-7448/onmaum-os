// 배포 + GitHub 반영을 한 번에 한다(2026-11-06 요청: "배포할 때마다 GitHub에도 자동으로 올려 줘").
//
//   npm run deploy                 Vercel 운영 배포 → 성공하면 GitHub에도 반영
//   npm run github                 GitHub 반영만 (배포는 안 함)
//   node scripts/deploy.mjs --allow-dirty   커밋 안 된 변경이 있어도 진행(권장하지 않음)
//
// 이 PC의 저장소는 ONMAUM-OS 루트 아래 onmaum-os-web 폴더 구조지만 GitHub 저장소는 onmaum-os-web 내용이
// 루트라서 두 저장소의 커밋 기록이 서로 다르다(이어 붙이려면 강제 푸시가 필요해 쓰지 않는다). 그래서 현재
// 커밋(HEAD)의 onmaum-os-web 내용을 GitHub용 복사본 폴더(MIRROR_DIR)에 덮어 쓴 뒤 일반 push 한다.
// 복사본은 OneDrive 밖(홈 폴더)에 둔다 — OneDrive 안의 .git은 동기화 중 깨지는 일이 있었다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_URL = "https://github.com/dsm-tech-7448/onmaum-os.git";
const MIRROR_DIR = path.join(os.homedir(), "onmaum-os-github-mirror");
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = new Set(process.argv.slice(2));
const githubOnly = args.has("--github-only");
const allowDirty = args.has("--allow-dirty");

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function git(cwd, ...gitArgs) {
  const r = spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${gitArgs.join(" ")} 실패: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

function gitOk(cwd, ...gitArgs) {
  return spawnSync("git", gitArgs, { cwd, encoding: "utf8" }).status === 0;
}

function ensureMirror(identity) {
  const broken = fs.existsSync(MIRROR_DIR) && !gitOk(MIRROR_DIR, "rev-parse", "--is-inside-work-tree");
  if (broken) {
    // 복사본일 뿐이라 깨졌으면 지우고 새로 받는다.
    console.log("GitHub용 복사본이 손상돼 새로 받습니다...");
    fs.rmSync(MIRROR_DIR, { recursive: true, force: true });
  }
  if (!fs.existsSync(MIRROR_DIR)) {
    console.log(`GitHub 저장소를 받는 중... (${MIRROR_DIR})`);
    const r = spawnSync("git", ["clone", "-q", GITHUB_URL, MIRROR_DIR], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git clone 실패: ${(r.stderr || "").trim()}`);
  }
  git(MIRROR_DIR, "config", "user.name", identity.name);
  git(MIRROR_DIR, "config", "user.email", identity.email);
  git(MIRROR_DIR, "pull", "-q", "--ff-only");
}

function syncToGithub() {
  const repoRoot = git(APP_DIR, "rev-parse", "--show-toplevel");
  const prefix = git(APP_DIR, "rev-parse", "--show-prefix"); // 예: "onmaum-os-web/"
  const headSha = git(APP_DIR, "rev-parse", "HEAD");
  const identity = {
    name: git(repoRoot, "config", "user.name") || "DSM Tech",
    email: git(repoRoot, "config", "user.email") || "dsm-tech@naver.com",
  };

  ensureMirror(identity);

  // 복사본의 추적 파일을 모두 지우고 HEAD의 onmaum-os-web 내용으로 다시 채운다(삭제된 파일도 반영되도록).
  const tracked = git(MIRROR_DIR, "ls-files", "-z").split("\0").filter(Boolean);
  for (const f of tracked) fs.rmSync(path.join(MIRROR_DIR, f), { force: true });

  const archive = spawnSync("git", ["archive", `HEAD:${prefix.replace(/\/$/, "")}`], {
    cwd: repoRoot,
    maxBuffer: 1 << 30,
  });
  if (archive.status !== 0) throw new Error(`git archive 실패: ${String(archive.stderr || "").trim()}`);
  const extract = spawnSync("tar", ["-x", "-C", MIRROR_DIR], { input: archive.stdout });
  if (extract.status !== 0) throw new Error(`tar 풀기 실패: ${String(extract.stderr || "").trim()}`);

  git(MIRROR_DIR, "add", "-A");
  if (!git(MIRROR_DIR, "status", "--porcelain")) {
    console.log("✅ GitHub는 이미 최신입니다(올릴 변경 없음).");
    return;
  }

  // 커밋 메시지 — 마지막으로 올린 이후의 이 PC 커밋 제목들을 모은다(처음이면 HEAD 제목만).
  const marker = path.join(MIRROR_DIR, ".git", "onmaum-last-local-head");
  const last = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  let subjects = [];
  if (last && gitOk(repoRoot, "cat-file", "-e", `${last}^{commit}`)) {
    subjects = git(repoRoot, "log", "--format=%s", `${last}..HEAD`, "--", APP_DIR).split("\n").filter(Boolean);
  }
  if (subjects.length === 0) subjects = [git(repoRoot, "log", "-1", "--format=%s")];
  const title = subjects.length > 1 ? `${subjects[0]} 외 ${subjects.length - 1}건` : subjects[0];
  const message = `${title}\n\n${subjects.map((s) => `- ${s}`).join("\n")}`;

  git(MIRROR_DIR, "commit", "-q", "-m", message);
  const branch = git(MIRROR_DIR, "branch", "--show-current") || "master";
  git(MIRROR_DIR, "push", "origin", branch);
  fs.writeFileSync(marker, headSha);
  console.log(`✅ GitHub에 올렸습니다: ${title}`);
}

// 1. 커밋 안 된 변경이 있으면 멈춘다 — 배포는 작업 폴더 기준이고 GitHub는 커밋 기준이라, 둘이 어긋나는 걸 막는다.
const dirty = git(APP_DIR, "status", "--porcelain", "--", ".");
if (dirty && !allowDirty) {
  fail(
    `커밋하지 않은 변경이 있습니다. 먼저 커밋한 뒤 다시 실행하세요(배포와 GitHub 내용이 달라지는 걸 막기 위해서입니다).\n${dirty}`
  );
}

// 2. Vercel 운영 배포 — 실패하면 GitHub에도 올리지 않는다.
if (!githubOnly) {
  console.log("▶ Vercel 운영 배포를 시작합니다...");
  const deploy = spawnSync("npx", ["vercel", "--prod", "--yes"], { cwd: APP_DIR, stdio: "inherit", shell: true });
  if (deploy.status !== 0) fail("Vercel 배포가 실패했습니다. GitHub에는 올리지 않았습니다.");
  console.log("✅ Vercel 배포 완료");
}

// 3. GitHub 반영 — 배포는 이미 끝난 뒤라 실패해도 배포는 그대로이고, `npm run github`로 다시 올리면 된다.
try {
  syncToGithub();
} catch (err) {
  fail(`${githubOnly ? "" : "배포는 완료됐지만 "}GitHub 반영에 실패했습니다: ${err.message}\n   → 잠시 뒤 \`npm run github\`로 다시 올려 보세요.`);
}
