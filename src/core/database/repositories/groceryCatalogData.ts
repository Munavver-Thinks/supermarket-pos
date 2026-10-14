/**
 * Reference catalog of common Indian kirana/supermarket products, used to seed a fresh
 * or demo store with a realistic starting inventory (see groceryCatalog.ts).
 *
 * Tax rates follow the simplified GST slabs (0% / 5% / 18% / 40%) from the September 2025
 * GST rationalization. They're representative defaults, not a compliance guarantee — verify
 * HSN-level rates against current CBIC notifications before relying on them for filing, and
 * adjust per-product via the inventory screen as needed.
 */

export type GroceryUom = "kg" | "g" | "l" | "ml" | "pcs";

export interface GroceryCatalogItem {
  category: string;
  name: string;
  brand: string | null;
  uom: GroceryUom;
  isWeighted: boolean;
  hsnCode: string;
  taxRatePercent: number;
  mrpRupees: number;
  salePriceRupees: number;
  costPriceRupees: number;
}

/**
 * [category, name, brand, uom, isWeighted, hsnCode, taxRatePercent, mrpRupees, salePriceRupees, costPriceRupees]
 * Kept as tuples for density — 160 rows is unwieldy as object literals. Mapped to
 * GroceryCatalogItem[] below.
 */
type Row = [string, string, string | null, GroceryUom, boolean, string, number, number, number, number];

const rows: Row[] = [
  // Rice & Grains
  ["Rice & Grains", "Sona Masoori Rice", null, "kg", true, "1006", 0, 48, 45, 40],
  ["Rice & Grains", "Ponni Rice", null, "kg", true, "1006", 0, 42, 40, 35],
  ["Rice & Grains", "Idli Rice", null, "kg", true, "1006", 0, 45, 42, 37],
  ["Rice & Grains", "India Gate Basmati Rice 1kg", "India Gate", "pcs", false, "1006", 5, 145, 135, 115],
  ["Rice & Grains", "Daawat Basmati Rice 1kg", "Daawat", "pcs", false, "1006", 5, 150, 140, 120],
  ["Rice & Grains", "Broken Wheat / Dalia", null, "kg", true, "1103", 0, 55, 50, 44],
  ["Rice & Grains", "Poha (Flattened Rice) 500g", null, "pcs", false, "1904", 5, 45, 40, 33],
  ["Rice & Grains", "Sooji / Rava 1kg", null, "pcs", false, "1103", 5, 55, 50, 42],
  ["Rice & Grains", "Kerala Matta Rice", null, "kg", true, "1006", 0, 55, 50, 44],
  ["Rice & Grains", "Bambino Semiya (Vermicelli) 200g", "Bambino", "pcs", false, "1902", 5, 35, 32, 26],

  // Atta, Flours & Sooji
  ["Atta, Flours & Sooji", "Aashirvaad Atta 5kg", "Aashirvaad", "pcs", false, "1101", 5, 260, 245, 215],
  ["Atta, Flours & Sooji", "Pillsbury Chakki Atta 5kg", "Pillsbury", "pcs", false, "1101", 5, 255, 240, 210],
  ["Atta, Flours & Sooji", "Maida (Refined Flour) 1kg", null, "pcs", false, "1101", 5, 48, 44, 37],
  ["Atta, Flours & Sooji", "Besan (Gram Flour) 1kg", null, "pcs", false, "1106", 5, 95, 88, 74],
  ["Atta, Flours & Sooji", "Rice Flour 1kg", null, "pcs", false, "1102", 5, 55, 50, 42],
  ["Atta, Flours & Sooji", "Ragi Flour 1kg", null, "pcs", false, "1102", 5, 70, 65, 55],

  // Pulses & Dals
  ["Pulses & Dals", "Toor Dal", null, "kg", true, "0713", 0, 155, 145, 128],
  ["Pulses & Dals", "Moong Dal", null, "kg", true, "0713", 0, 130, 120, 105],
  ["Pulses & Dals", "Chana Dal", null, "kg", true, "0713", 0, 90, 85, 74],
  ["Pulses & Dals", "Urad Dal", null, "kg", true, "0713", 0, 140, 130, 113],
  ["Pulses & Dals", "Masoor Dal", null, "kg", true, "0713", 0, 100, 92, 80],
  ["Pulses & Dals", "Rajma (Kidney Beans)", null, "kg", true, "0713", 0, 135, 125, 108],
  ["Pulses & Dals", "Kabuli Chana (Chickpeas)", null, "kg", true, "0713", 0, 95, 88, 76],
  ["Pulses & Dals", "Dried Green Peas", null, "kg", true, "0713", 0, 80, 74, 64],

  // Cooking Oils & Ghee
  ["Cooking Oils & Ghee", "Fortune Sunflower Oil 1L", "Fortune", "pcs", false, "1512", 5, 165, 155, 135],
  ["Cooking Oils & Ghee", "Saffola Gold Oil 1L", "Saffola", "pcs", false, "1515", 5, 195, 182, 158],
  ["Cooking Oils & Ghee", "Gemini Groundnut Oil 1L", "Gemini", "pcs", false, "1508", 5, 210, 198, 172],
  ["Cooking Oils & Ghee", "Idhayam Gingelly Oil 1L", "Idhayam", "pcs", false, "1515", 5, 240, 225, 196],
  ["Cooking Oils & Ghee", "Amul Pure Ghee 1L", "Amul", "pcs", false, "0405", 5, 620, 590, 520],
  ["Cooking Oils & Ghee", "Aachi Coconut Oil 1L", "Aachi", "pcs", false, "1513", 5, 210, 198, 172],
  ["Cooking Oils & Ghee", "Parachute Coconut Oil 500ml", "Parachute", "pcs", false, "1513", 5, 145, 135, 115],
  ["Cooking Oils & Ghee", "KLF Coconut Oil 500ml", "KLF", "pcs", false, "1513", 5, 140, 130, 110],

  // Sugar, Salt & Jaggery
  ["Sugar, Salt & Jaggery", "Sugar", null, "kg", true, "1701", 0, 45, 42, 37],
  ["Sugar, Salt & Jaggery", "Tata Salt 1kg", "Tata", "pcs", false, "2501", 0, 28, 25, 20],
  ["Sugar, Salt & Jaggery", "Jaggery (Naatu Sarkarai)", null, "kg", true, "1701", 0, 60, 55, 47],
  ["Sugar, Salt & Jaggery", "Brown Sugar 1kg", null, "pcs", false, "1701", 5, 65, 60, 50],
  ["Sugar, Salt & Jaggery", "Rock Salt (Sendha Namak) 500g", null, "pcs", false, "2501", 5, 40, 36, 29],
  ["Sugar, Salt & Jaggery", "Palm Jaggery (Karupatti) 500g", null, "pcs", false, "1701", 0, 90, 82, 68],

  // Spices & Masalas
  ["Spices & Masalas", "Aachi Chilli Powder 200g", "Aachi", "pcs", false, "0904", 5, 60, 55, 45],
  ["Spices & Masalas", "Aachi Turmeric Powder 200g", "Aachi", "pcs", false, "0910", 5, 55, 50, 41],
  ["Spices & Masalas", "Everest Coriander Powder 200g", "Everest", "pcs", false, "0909", 5, 50, 46, 38],
  ["Spices & Masalas", "MDH Garam Masala 100g", "MDH", "pcs", false, "0910", 5, 85, 78, 65],
  ["Spices & Masalas", "Sakthi Sambar Powder 200g", "Sakthi", "pcs", false, "0910", 5, 65, 60, 49],
  ["Spices & Masalas", "Mustard Seeds 100g", null, "pcs", false, "1207", 5, 25, 22, 18],
  ["Spices & Masalas", "Cumin Seeds (Jeera) 100g", null, "pcs", false, "0909", 5, 45, 40, 33],
  ["Spices & Masalas", "Whole Black Pepper 100g", null, "pcs", false, "0904", 5, 90, 82, 68],
  ["Spices & Masalas", "Everest Kitchen King Masala 100g", "Everest", "pcs", false, "0910", 5, 65, 60, 49],

  // Tea, Coffee & Beverage Mixes
  ["Tea, Coffee & Beverage Mixes", "Tata Tea Gold 500g", "Tata", "pcs", false, "0902", 5, 260, 245, 210],
  ["Tea, Coffee & Beverage Mixes", "Red Label Tea 500g", "Brooke Bond", "pcs", false, "0902", 5, 250, 235, 200],
  ["Tea, Coffee & Beverage Mixes", "Nescafe Classic Coffee 100g", "Nescafe", "pcs", false, "2101", 5, 285, 270, 230],
  ["Tea, Coffee & Beverage Mixes", "Bru Instant Coffee 100g", "Bru", "pcs", false, "2101", 5, 215, 200, 170],
  ["Tea, Coffee & Beverage Mixes", "Horlicks 500g", "Horlicks", "pcs", false, "1901", 5, 245, 230, 198],
  ["Tea, Coffee & Beverage Mixes", "Bournvita 500g", "Cadbury", "pcs", false, "1901", 5, 230, 215, 185],

  // Coffee & Filter Coffee
  ["Coffee & Filter Coffee", "Narasus Filter Coffee 200g", "Narasus", "pcs", false, "0901", 5, 130, 120, 100],
  ["Coffee & Filter Coffee", "Leo Coffee 200g", "Leo", "pcs", false, "0901", 5, 125, 115, 96],
  ["Coffee & Filter Coffee", "Cothas Coffee 200g", "Cothas", "pcs", false, "0901", 5, 140, 130, 108],
  ["Coffee & Filter Coffee", "Narasus Coffee Decoction 200ml", "Narasus", "pcs", false, "2101", 5, 60, 55, 45],
  ["Coffee & Filter Coffee", "Chicory Mixed Filter Coffee Powder 500g", null, "pcs", false, "0901", 5, 220, 205, 172],

  // South Indian Ready Mixes & Podis
  ["South Indian Ready Mixes & Podis", "MTR Dosa Mix 500g", "MTR", "pcs", false, "1901", 5, 95, 88, 74],
  ["South Indian Ready Mixes & Podis", "MTR Idli Mix 500g", "MTR", "pcs", false, "1901", 5, 90, 84, 70],
  ["South Indian Ready Mixes & Podis", "Gits Rava Idli Mix 200g", "Gits", "pcs", false, "1901", 5, 75, 70, 57],
  ["South Indian Ready Mixes & Podis", "MTR Bisi Bele Bath Mix 200g", "MTR", "pcs", false, "2106", 5, 85, 78, 65],
  ["South Indian Ready Mixes & Podis", "Idli Podi (Milagai Podi) 200g", "Sakthi", "pcs", false, "2106", 5, 70, 65, 54],
  ["South Indian Ready Mixes & Podis", "Curry Leaf Podi 200g", null, "pcs", false, "2106", 5, 65, 60, 49],
  ["South Indian Ready Mixes & Podis", "Sakthi Rasam Powder 200g", "Sakthi", "pcs", false, "0910", 5, 60, 55, 45],
  ["South Indian Ready Mixes & Podis", "Puliyodharai Paste 200g", "Aachi", "pcs", false, "2103", 5, 75, 70, 57],
  ["South Indian Ready Mixes & Podis", "Vathal Kuzhambu Mix 200g", "Aachi", "pcs", false, "2103", 5, 65, 60, 49],

  // Dairy Products
  ["Dairy Products", "Aavin Toned Milk 500ml", "Aavin", "pcs", false, "0401", 0, 24, 23, 20],
  ["Dairy Products", "Amul Gold Milk 500ml", "Amul", "pcs", false, "0401", 0, 33, 32, 28],
  ["Dairy Products", "Amul Butter 100g", "Amul", "pcs", false, "0405", 5, 58, 54, 46],
  ["Dairy Products", "Amul Cheese Slices 200g", "Amul", "pcs", false, "0406", 5, 125, 118, 100],
  ["Dairy Products", "Nandini Curd 400g", "Nandini", "pcs", false, "0403", 0, 34, 32, 27],
  ["Dairy Products", "Milky Mist Paneer 200g", "Milky Mist", "pcs", false, "0406", 5, 90, 85, 72],

  // Bread & Bakery
  ["Bread & Bakery", "Britannia Bread 400g", "Britannia", "pcs", false, "1905", 0, 45, 42, 35],
  ["Bread & Bakery", "Modern Bread 400g", "Modern", "pcs", false, "1905", 0, 42, 40, 33],
  ["Bread & Bakery", "Britannia Bun Pack", "Britannia", "pcs", false, "1905", 5, 35, 32, 27],
  ["Bread & Bakery", "Rusk 200g", "Britannia", "pcs", false, "1905", 5, 40, 37, 31],

  // Biscuits & Cookies
  ["Biscuits & Cookies", "Parle-G Biscuit 200g", "Parle", "pcs", false, "1905", 5, 20, 18, 15],
  ["Biscuits & Cookies", "Britannia Good Day 200g", "Britannia", "pcs", false, "1905", 5, 35, 32, 27],
  ["Biscuits & Cookies", "Britannia Marie Gold 250g", "Britannia", "pcs", false, "1905", 5, 40, 37, 31],
  ["Biscuits & Cookies", "Oreo Biscuit 120g", "Oreo", "pcs", false, "1905", 5, 35, 32, 27],
  ["Biscuits & Cookies", "Sunfeast Dark Fantasy 300g", "Sunfeast", "pcs", false, "1905", 5, 95, 88, 74],
  ["Biscuits & Cookies", "Hide & Seek 120g", "Parle", "pcs", false, "1905", 5, 35, 32, 27],

  // Snacks & Namkeen
  ["Snacks & Namkeen", "Lays Classic Salted 52g", "Lays", "pcs", false, "2005", 5, 20, 18, 15],
  ["Snacks & Namkeen", "Kurkure Masala Munch 90g", "Kurkure", "pcs", false, "1904", 5, 20, 18, 15],
  ["Snacks & Namkeen", "Haldiram's Aloo Bhujia 200g", "Haldiram's", "pcs", false, "2106", 5, 55, 50, 42],
  ["Snacks & Namkeen", "Haldiram's Mixture 200g", "Haldiram's", "pcs", false, "2106", 5, 55, 50, 42],
  ["Snacks & Namkeen", "Bikaji Bhujia Sev 200g", "Bikaji", "pcs", false, "2106", 5, 50, 46, 38],
  ["Snacks & Namkeen", "Act II Popcorn 40g", "Act II", "pcs", false, "1904", 5, 25, 22, 18],
  ["Snacks & Namkeen", "Kerala Banana Chips 200g", null, "pcs", false, "2008", 5, 60, 55, 45],
  ["Snacks & Namkeen", "Jackfruit Chips 200g", null, "pcs", false, "2008", 5, 70, 65, 54],
  ["Snacks & Namkeen", "Murukku 200g", "Grand Sweets", "pcs", false, "1905", 5, 55, 50, 41],
  ["Snacks & Namkeen", "Thattai 200g", null, "pcs", false, "1905", 5, 50, 46, 38],

  // Chocolates & Confectionery
  ["Chocolates & Confectionery", "Cadbury Dairy Milk 55g", "Cadbury", "pcs", false, "1806", 5, 50, 46, 38],
  ["Chocolates & Confectionery", "Nestle KitKat 4 Finger", "Nestle", "pcs", false, "1806", 5, 45, 41, 34],
  ["Chocolates & Confectionery", "5 Star Chocolate 40g", "Cadbury", "pcs", false, "1806", 5, 20, 18, 15],
  ["Chocolates & Confectionery", "Eclairs Toffee Pack 150g", "Parle", "pcs", false, "1704", 5, 50, 46, 38],
  ["Chocolates & Confectionery", "Alpenliebe Candy Pack", "Perfetti", "pcs", false, "1704", 5, 10, 9, 7],

  // Noodles, Pasta & Ready-to-Eat
  ["Noodles, Pasta & Ready-to-Eat", "Maggi 2-Minute Noodles 70g", "Maggi", "pcs", false, "1902", 5, 14, 13, 10],
  ["Noodles, Pasta & Ready-to-Eat", "Top Ramen Noodles 70g", "Top Ramen", "pcs", false, "1902", 5, 14, 13, 10],
  ["Noodles, Pasta & Ready-to-Eat", "Sunfeast Pasta Treat 70g", "Sunfeast", "pcs", false, "1902", 5, 25, 22, 18],
  ["Noodles, Pasta & Ready-to-Eat", "MTR Ready to Eat Poha 180g", "MTR", "pcs", false, "2106", 5, 65, 60, 49],
  ["Noodles, Pasta & Ready-to-Eat", "Kohinoor Instant Pulao Mix 200g", "Kohinoor", "pcs", false, "2106", 5, 75, 70, 57],

  // Sauces, Spreads & Condiments
  ["Sauces, Spreads & Condiments", "Kissan Tomato Ketchup 500g", "Kissan", "pcs", false, "2103", 5, 105, 98, 82],
  ["Sauces, Spreads & Condiments", "Maggi Hot & Sweet Sauce 500g", "Maggi", "pcs", false, "2103", 5, 105, 98, 82],
  ["Sauces, Spreads & Condiments", "Kissan Mixed Fruit Jam 500g", "Kissan", "pcs", false, "2007", 5, 145, 135, 113],
  ["Sauces, Spreads & Condiments", "Fun Foods Mayonnaise 250g", "Fun Foods", "pcs", false, "2103", 5, 75, 70, 57],
  ["Sauces, Spreads & Condiments", "Ching's Schezwan Chutney 250g", "Ching's", "pcs", false, "2103", 5, 85, 80, 66],

  // Pickles & Papad
  ["Pickles & Papad", "Priya Mango Pickle 300g", "Priya", "pcs", false, "2001", 5, 75, 70, 57],
  ["Pickles & Papad", "Mother's Recipe Mixed Pickle 400g", "Mother's Recipe", "pcs", false, "2001", 5, 95, 88, 74],
  ["Pickles & Papad", "Lijjat Papad 200g", "Lijjat", "pcs", false, "1905", 5, 60, 55, 45],
  ["Pickles & Papad", "Priya Gongura Pickle 300g", "Priya", "pcs", false, "2001", 5, 80, 74, 61],
  ["Pickles & Papad", "Priya Andhra Avakaya Pickle 400g", "Priya", "pcs", false, "2001", 5, 110, 102, 85],
  ["Pickles & Papad", "Andhra Karam Podi 200g", "Aachi", "pcs", false, "2106", 5, 65, 60, 49],

  // Dry Fruits & Nuts
  ["Dry Fruits & Nuts", "Almonds (Badam)", null, "kg", true, "0802", 5, 750, 700, 610],
  ["Dry Fruits & Nuts", "Cashew Nuts (Kaju)", null, "kg", true, "0801", 5, 850, 800, 700],
  ["Dry Fruits & Nuts", "Raisins (Kishmish)", null, "kg", true, "0806", 5, 220, 205, 175],
  ["Dry Fruits & Nuts", "Pistachios", null, "kg", true, "0802", 5, 950, 900, 790],
  ["Dry Fruits & Nuts", "Dates (Khajur) 500g", null, "pcs", false, "0804", 5, 120, 110, 92],

  // Soft Drinks & Juices
  ["Soft Drinks & Juices", "Coca-Cola 750ml", "Coca-Cola", "pcs", false, "2202", 40, 40, 38, 28],
  ["Soft Drinks & Juices", "Pepsi 750ml", "Pepsi", "pcs", false, "2202", 40, 40, 38, 28],
  ["Soft Drinks & Juices", "Sprite 750ml", "Sprite", "pcs", false, "2202", 40, 40, 38, 28],
  ["Soft Drinks & Juices", "Thums Up 750ml", "Thums Up", "pcs", false, "2202", 40, 40, 38, 28],
  ["Soft Drinks & Juices", "Real Fruit Juice Mixed Fruit 1L", "Real", "pcs", false, "2009", 5, 120, 112, 95],
  ["Soft Drinks & Juices", "Frooti Mango Drink 200ml", "Frooti", "pcs", false, "2202", 5, 20, 18, 15],
  ["Soft Drinks & Juices", "Bisleri Soda 750ml", "Bisleri", "pcs", false, "2201", 18, 25, 22, 17],

  // Packaged Drinking Water
  ["Packaged Drinking Water", "Bisleri Water 1L", "Bisleri", "pcs", false, "2201", 18, 20, 18, 14],
  ["Packaged Drinking Water", "Kinley Water 1L", "Kinley", "pcs", false, "2201", 18, 20, 18, 14],
  ["Packaged Drinking Water", "Bisleri Water 20L Can", "Bisleri", "pcs", false, "2201", 18, 80, 70, 50],
  ["Packaged Drinking Water", "Aquafina Water 500ml", "Aquafina", "pcs", false, "2201", 18, 10, 9, 6],

  // Personal Care
  ["Personal Care", "Lifebuoy Soap 100g", "Lifebuoy", "pcs", false, "3401", 5, 35, 32, 26],
  ["Personal Care", "Dove Soap 100g", "Dove", "pcs", false, "3401", 5, 65, 60, 50],
  ["Personal Care", "Colgate Toothpaste 200g", "Colgate", "pcs", false, "3306", 5, 110, 102, 86],
  ["Personal Care", "Closeup Toothpaste 150g", "Closeup", "pcs", false, "3306", 5, 85, 78, 65],
  ["Personal Care", "Head & Shoulders Shampoo 180ml", "Head & Shoulders", "pcs", false, "3305", 5, 175, 165, 140],
  ["Personal Care", "Clinic Plus Shampoo 175ml", "Clinic Plus", "pcs", false, "3305", 5, 95, 88, 74],
  ["Personal Care", "Colgate Toothbrush", "Colgate", "pcs", false, "9603", 5, 30, 27, 21],
  ["Personal Care", "Nivea Body Lotion 200ml", "Nivea", "pcs", false, "3304", 5, 195, 182, 155],
  ["Personal Care", "Gillette Shaving Razor", "Gillette", "pcs", false, "8212", 5, 60, 55, 45],

  // Household Cleaning
  ["Household Cleaning", "Surf Excel Detergent Powder 1kg", "Surf Excel", "pcs", false, "3402", 18, 130, 122, 103],
  ["Household Cleaning", "Ariel Detergent Powder 1kg", "Ariel", "pcs", false, "3402", 18, 135, 126, 107],
  ["Household Cleaning", "Vim Dishwash Bar", "Vim", "pcs", false, "3402", 18, 20, 18, 14],
  ["Household Cleaning", "Vim Dishwash Liquid 500ml", "Vim", "pcs", false, "3402", 18, 95, 88, 74],
  ["Household Cleaning", "Harpic Toilet Cleaner 500ml", "Harpic", "pcs", false, "3808", 18, 95, 88, 74],
  ["Household Cleaning", "Lizol Floor Cleaner 500ml", "Lizol", "pcs", false, "3808", 18, 115, 107, 90],
  ["Household Cleaning", "Odonil Air Freshener", "Odonil", "pcs", false, "3307", 18, 65, 60, 49],
  ["Household Cleaning", "Good Knight Mosquito Repellent Refill", "Good Knight", "pcs", false, "3808", 18, 70, 65, 54],
  ["Household Cleaning", "Scotch Brite Scrub Pad", "Scotch Brite", "pcs", false, "3402", 18, 25, 22, 17],

  // Baby Care
  ["Baby Care", "Pampers Diapers Medium (Pack of 10)", "Pampers", "pcs", false, "9619", 5, 250, 235, 200],
  ["Baby Care", "Johnson's Baby Powder 200g", "Johnson's", "pcs", false, "3304", 5, 130, 122, 103],
  ["Baby Care", "Johnson's Baby Soap 100g", "Johnson's", "pcs", false, "3401", 5, 55, 50, 41],
  ["Baby Care", "Cerelac Baby Cereal 300g", "Cerelac", "pcs", false, "1901", 5, 220, 205, 175],

  // Fresh Vegetables
  ["Fresh Vegetables", "Tomato", null, "kg", true, "0702", 0, 40, 35, 22],
  ["Fresh Vegetables", "Onion", null, "kg", true, "0703", 0, 35, 30, 20],
  ["Fresh Vegetables", "Potato", null, "kg", true, "0701", 0, 30, 26, 18],
  ["Fresh Vegetables", "Carrot", null, "kg", true, "0706", 0, 45, 40, 28],
  ["Fresh Vegetables", "Cabbage", null, "kg", true, "0704", 0, 30, 25, 17],
  ["Fresh Vegetables", "Cauliflower", null, "kg", true, "0704", 0, 40, 35, 24],
  ["Fresh Vegetables", "Brinjal (Eggplant)", null, "kg", true, "0709", 0, 35, 30, 20],
  ["Fresh Vegetables", "Ladies Finger (Okra)", null, "kg", true, "0709", 0, 45, 40, 28],
  ["Fresh Vegetables", "Green Chilli", null, "kg", true, "0709", 0, 50, 45, 30],
  ["Fresh Vegetables", "Coriander Leaves (bunch)", null, "pcs", false, "0709", 0, 10, 8, 5],
  ["Fresh Vegetables", "Curry Leaves (bunch)", null, "pcs", false, "0709", 0, 5, 5, 3],
  ["Fresh Vegetables", "Beans", null, "kg", true, "0708", 0, 55, 50, 35],
  ["Fresh Vegetables", "Cucumber", null, "kg", true, "0707", 0, 30, 26, 18],
  ["Fresh Vegetables", "Drumstick", null, "kg", true, "0709", 0, 60, 54, 38],
  ["Fresh Vegetables", "Raw Banana (Plantain)", null, "kg", true, "0803", 0, 35, 30, 20],
  ["Fresh Vegetables", "Ash Gourd", null, "kg", true, "0709", 0, 30, 26, 18],
  ["Fresh Vegetables", "Snake Gourd", null, "kg", true, "0709", 0, 35, 30, 20],
  ["Fresh Vegetables", "Bitter Gourd", null, "kg", true, "0709", 0, 45, 40, 28],
  ["Fresh Vegetables", "Yam (Senai Kizhangu)", null, "kg", true, "0714", 0, 50, 45, 32],
  ["Fresh Vegetables", "Colocasia (Seppankizhangu)", null, "kg", true, "0714", 0, 55, 50, 35],
  ["Fresh Vegetables", "Tapioca (Kappa)", null, "kg", true, "0714", 0, 30, 26, 18],

  // Fresh Fruits
  ["Fresh Fruits", "Banana", null, "kg", true, "0803", 0, 50, 45, 32],
  ["Fresh Fruits", "Apple", null, "kg", true, "0808", 0, 180, 165, 135],
  ["Fresh Fruits", "Orange", null, "kg", true, "0805", 0, 90, 80, 60],
  ["Fresh Fruits", "Mango", null, "kg", true, "0804", 0, 110, 100, 75],
  ["Fresh Fruits", "Papaya", null, "kg", true, "0807", 0, 40, 35, 24],
  ["Fresh Fruits", "Watermelon", null, "kg", true, "0807", 0, 25, 22, 15],
  ["Fresh Fruits", "Grapes", null, "kg", true, "0806", 0, 90, 80, 58],
  ["Fresh Fruits", "Pomegranate", null, "kg", true, "0810", 0, 150, 135, 105],
  ["Fresh Fruits", "Guava", null, "kg", true, "0804", 0, 60, 54, 38],
  ["Fresh Fruits", "Jackfruit", null, "kg", true, "0810", 0, 45, 40, 28],

  // Eggs, Meat & Frozen Foods
  ["Eggs, Meat & Frozen Foods", "Eggs (Tray of 30)", null, "pcs", false, "0407", 0, 210, 195, 165],
  ["Eggs, Meat & Frozen Foods", "Eggs (Pack of 6)", null, "pcs", false, "0407", 0, 45, 42, 35],
  ["Eggs, Meat & Frozen Foods", "Chicken", null, "kg", true, "0207", 0, 220, 210, 180],
  ["Eggs, Meat & Frozen Foods", "McCain Frozen French Fries 420g", "McCain", "pcs", false, "2004", 5, 135, 125, 105],
  ["Eggs, Meat & Frozen Foods", "Godrej Yummiez Chicken Nuggets 425g", "Godrej Yummiez", "pcs", false, "1601", 5, 235, 220, 188],
  ["Eggs, Meat & Frozen Foods", "ID Fresh Idli/Dosa Batter 1kg", "ID Fresh", "pcs", false, "1901", 5, 85, 78, 65],

  // Pooja & Festive Needs
  ["Pooja & Festive Needs", "Cycle Agarbatti (Incense Sticks) Pack", "Cycle", "pcs", false, "3307", 5, 45, 40, 33],
  ["Pooja & Festive Needs", "Camphor (Karpooram) 50g", null, "pcs", false, "2914", 5, 40, 36, 29],
  ["Pooja & Festive Needs", "Cotton Wicks (Vilakku Thiri) Pack", null, "pcs", false, "5808", 5, 20, 18, 14],
  ["Pooja & Festive Needs", "Lamp Oil (Vilakku Ennai) 500ml", null, "pcs", false, "1518", 5, 90, 82, 68],
  ["Pooja & Festive Needs", "Kumkum & Turmeric Combo Pack", null, "pcs", false, "3304", 5, 25, 22, 17],
  ["Pooja & Festive Needs", "Sandalwood Powder (Chandan) 50g", null, "pcs", false, "3307", 5, 55, 50, 41],
];

export const groceryCategories: string[] = [...new Set(rows.map((r) => r[0]))];

export const groceryCatalog: GroceryCatalogItem[] = rows.map(
  ([category, name, brand, uom, isWeighted, hsnCode, taxRatePercent, mrpRupees, salePriceRupees, costPriceRupees]) => ({
    category,
    name,
    brand,
    uom,
    isWeighted,
    hsnCode,
    taxRatePercent,
    mrpRupees,
    salePriceRupees,
    costPriceRupees,
  }),
);
