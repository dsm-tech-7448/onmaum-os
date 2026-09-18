import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { companyProfile, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

// company_profile_시드데이터.json lives one level above this project folder,
// at the root of the ONMAUM-OS working directory.
const SEED_JSON_PATH = resolve(
  __dirname,
  "../../company_profile_시드데이터.json"
);

type CompanyProfileSeed = {
  brand_name: string;
  company_name: string;
  ceo_name: string;
  business_number: string;
  corporate_registration_number: string;
  opening_date: string;
  business_place_address: string;
  headquarters_address: string;
  business_type: string;
  business_item: string;
  phone: string;
  fax: string;
  email: string;
  website_main: string;
  website_secondary: string;
  bank_name: string;
  account_number: string;
  account_type: string;
  account_holder: string;
  swift_code: string;
  logo_image: string;
  seal_image: string;
  note: string;
};

async function seedCompanyProfile() {
  const raw = readFileSync(SEED_JSON_PATH, "utf-8");
  const parsed = JSON.parse(raw) as { company_profile: CompanyProfileSeed };
  const seed = parsed.company_profile;

  const [existing] = await db
    .select()
    .from(companyProfile)
    .where(eq(companyProfile.businessNumber, seed.business_number))
    .limit(1);

  if (existing) {
    console.log(`company_profile already seeded (${seed.brand_name}) — skipping.`);
    return;
  }

  await db.insert(companyProfile).values({
    brandName: seed.brand_name,
    companyName: seed.company_name,
    ceoName: seed.ceo_name,
    businessNumber: seed.business_number,
    corporateRegistrationNumber: seed.corporate_registration_number,
    openingDate: seed.opening_date,
    businessPlaceAddress: seed.business_place_address,
    headquartersAddress: seed.headquarters_address,
    businessType: seed.business_type,
    businessItem: seed.business_item,
    phone: seed.phone,
    fax: seed.fax,
    email: seed.email,
    websiteMain: seed.website_main,
    websiteSecondary: seed.website_secondary,
    bankName: seed.bank_name,
    accountNumber: seed.account_number,
    accountType: seed.account_type,
    accountHolder: seed.account_holder,
    swiftCode: seed.swift_code,
    logoImage: seed.logo_image,
    sealImage: seed.seal_image,
    note: seed.note,
  });

  console.log(`company_profile seeded: ${seed.brand_name} (${seed.company_name})`);
}

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "관리자";

  if (!email || !password) {
    console.log(
      "ADMIN_EMAIL / ADMIN_PASSWORD not set in .env.local — skipping admin user seed."
    );
    return;
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`admin user already exists (${email}) — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    email,
    passwordHash,
    name,
    role: "admin",
  });

  console.log(`admin user seeded: ${email}`);
}

async function main() {
  await seedCompanyProfile();
  await seedAdminUser();
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
