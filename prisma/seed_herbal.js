const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const prisma = new PrismaClient();

async function main() {
  console.log("🌿 Seeding Herbal Products & Categories for Herbalhub...");

  // 1. Store Settings & Contact
  const existingContact = await prisma.contactUs.findFirst();
  if (existingContact) {
    await prisma.contactUs.update({
      where: { id: existingContact.id },
      data: {
        title: "Herbalhub Contact",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500",
        address: "Uttar Brindabon para, bogura",
        google_map: "https://maps.google.com",
        phone_number: "01969968555",
        primary_email: "herbalhubbd@gmail.com",
        description: "Herbalhub is your trusted destination for 100% authentic herbal, organic & ayurvedic natural wellness products in Bangladesh.",
        facebook: "https://facebook.com/herbalhubbd",
        linkedIn: "https://linkedin.com",
        youtube: "https://youtube.com",
        instagram: "https://instagram.com",
        twitter: "https://twitter.com",
      },
    });
  } else {
    await prisma.contactUs.create({
      data: {
        title: "Herbalhub Contact",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500",
        address: "Uttar Brindabon para, bogura",
        google_map: "https://maps.google.com",
        phone_number: "01969968555",
        primary_email: "herbalhubbd@gmail.com",
        description: "Herbalhub is your trusted destination for 100% authentic herbal, organic & ayurvedic natural wellness products in Bangladesh.",
        facebook: "https://facebook.com/herbalhubbd",
        linkedIn: "https://linkedin.com",
        youtube: "https://youtube.com",
        instagram: "https://instagram.com",
        twitter: "https://twitter.com",
      },
    });
  }

  // 2. Main Category
  const mainCat = await prisma.mainCategory.upsert({
    where: { code: "HERBAL_HEALTH" },
    update: {},
    create: {
      code: "HERBAL_HEALTH",
      name: "Herbal & Ayurvedic Health",
      image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500",
      description: "Natural herbal remedies, supplements, and wellness essentials",
      status: true,
    },
  });

  // 3. Categories
  const catDiabetes = await prisma.category.upsert({
    where: { code: "DIABETES_CARE" },
    update: {},
    create: {
      code: "DIABETES_CARE",
      name: "Diabetes Care",
      image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500",
      mainCategoryId: mainCat.id,
      status: true,
    },
  });

  const catSupplements = await prisma.category.upsert({
    where: { code: "NATURAL_SUPPLIMENT" },
    update: {},
    create: {
      code: "NATURAL_SUPPLIMENT",
      name: "Natural Supplement",
      image: "https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500",
      mainCategoryId: mainCat.id,
      status: true,
    },
  });

  // 4. SubCategories
  const subCatSugar = await prisma.subCategory.upsert({
    where: { code: "SUGAR_CONTROL" },
    update: {},
    create: {
      code: "SUGAR_CONTROL",
      name: "Sugar Control",
      categoryId: catDiabetes.id,
      status: true,
    },
  });

  const subCatImmunity = await prisma.subCategory.upsert({
    where: { code: "IMMUNITY_BOOSTER" },
    update: {},
    create: {
      code: "IMMUNITY_BOOSTER",
      name: "Immunity & Vitality",
      categoryId: catSupplements.id,
      status: true,
    },
  });

  // 5. Brand
  let brand = await prisma.brand.findFirst({ where: { name: "Herbalhub Organics" } });
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        name: "Herbalhub Organics",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500",
      },
    });
  }

  // 6. Unit
  let unit = await prisma.unit.findFirst({ where: { name: "Bottle" } });
  if (!unit) {
    unit = await prisma.unit.create({
      data: {
        name: "Bottle",
        shortName: "btl",
      },
    });
  }

  // 7. Products
  const dia3 = await prisma.product.upsert({
    where: { slug: "dia-3-herbal-sugar-care" },
    update: {},
    create: {
      slug: "dia-3-herbal-sugar-care",
      sku: "DIA3-001",
      productName: "Dia 3 - Natural Herbal Sugar Care Capsule",
      sellingType: "Retail",
      subCategoryId: subCatSugar.id,
      brandId: brand.id,
      unitId: unit.id,
      price: 1250.0,
      costPrice: 850.0,
      quantity: 100,
      images: [
        "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600",
      ],
      description: "ডায়াবেটিস অবহেলা করলে ঝুঁকি বাড়ে, সচেতন থাকুন। Dia 3 আপনার সুগার কেয়ারের প্রাকৃতিক বিশ্বস্ত বন্ধু। 100% ভেষজ উপাদান সমৃদ্ধ।",
      taxType: "None",
      tax: 0,
      status: true,
      insideDhakaDeliveryCharge: 60.0,
      outsideDhakaDeliveryCharge: 120.0,
    },
  });

  const organicHoney = await prisma.product.upsert({
    where: { slug: "pure-sundarban-raw-honey" },
    update: {},
    create: {
      slug: "pure-sundarban-raw-honey",
      sku: "HONEY-002",
      productName: "Pure Sundarban Wild Raw Honey",
      sellingType: "Retail",
      subCategoryId: subCatImmunity.id,
      brandId: brand.id,
      unitId: unit.id,
      price: 850.0,
      costPrice: 550.0,
      quantity: 75,
      images: [
        "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=600",
      ],
      description: "প্রাকৃতিক সুন্দরবনের খাঁটি কাঁচা মধু। কোনো প্রকার ভেজাল বা কৃত্রিম চিনি মুক্ত, সরাসরি প্রাকৃতিক মৌচাক থেকে সংগৃহীত।",
      taxType: "None",
      tax: 0,
      status: true,
      insideDhakaDeliveryCharge: 60.0,
      outsideDhakaDeliveryCharge: 120.0,
    },
  });

  console.log("✅ Herbalhub Products & Categories seeded successfully!");
}

main()
  .catch((err) => {
    console.error("Seed error:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
