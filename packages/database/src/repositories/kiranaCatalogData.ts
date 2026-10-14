/**
 * Reference catalog of a Tamil Nadu kirana/supermarket's everyday stock — rice & grains,
 * pulses, oils, spices, vegetables, fruits, dairy, snacks, beverages, and household items.
 * Used to seed a fresh/demo store with realistic Tamil-bilingual products, Tanglish search
 * aliases, and real opening stock quantities (see kiranaCatalog.ts).
 *
 * Source data gave only a single selling price per product and no HSN/tax rate, so every
 * item is seeded at 0% GST with cost price left unset (0) — both are editable per product
 * via the inventory screen once real supplier costs and HSN codes are known.
 */

export type KiranaUom = "kg" | "l" | "pcs";

export interface KiranaCatalogItem {
  sku: string;
  category: string;
  name: string;
  nameTamil: string;
  tanglish: string;
  /** Selling unit as sold at the counter, e.g. "1 kg", "500 g", "1 pc". */
  unit: string;
  priceRupees: number;
  stockQty: number;
  reorderLevel: number;
}

export const kiranaCategories = [
  "Rice & Grains",
  "Pulses & Dals",
  "Oils & Ghee",
  "Spices & Powders",
  "Vegetables",
  "Fruits",
  "Dairy",
  "Snacks",
  "Beverages & Sweeteners",
  "Household & Cleaning",
] as const;

/**
 * [sku, category, name, nameTamil, tanglish, unit, priceRupees, stockQty, reorderLevel]
 * Kept as tuples for density. Mapped to KiranaCatalogItem[] below.
 */
type Row = [string, string, string, string, string, string, number, number, number];

const rows: Row[] = [
  // Rice & Grains
  ["RG-001", "Rice & Grains", "Ponni Boiled Rice", "பொன்னி புழுங்கல் அரிசி", "Ponni Puzhungal Arisi", "1 kg", 62, 140, 40],
  ["RG-002", "Rice & Grains", "Ponni Raw Rice", "பொன்னி பச்சரிசி", "Ponni Pacharisi", "1 kg", 68, 95, 40],
  ["RG-003", "Rice & Grains", "Idli Rice", "இட்லி அரிசி", "Idli Arisi", "1 kg", 55, 120, 35],
  ["RG-004", "Rice & Grains", "Basmati Rice", "பாஸ்மதி அரிசி", "Basmati Arisi", "1 kg", 145, 28, 15],
  ["RG-005", "Rice & Grains", "Wheat Flour", "கோதுமை மாவு", "Kothumai Maavu", "1 kg", 52, 64, 25],
  ["RG-006", "Rice & Grains", "Ragi Flour", "கேழ்வரகு மாவு", "Kezhvaragu Maavu", "500 g", 48, 22, 20],
  ["RG-007", "Rice & Grains", "Rice Flour", "அரிசி மாவு", "Arisi Maavu", "500 g", 42, 38, 20],
  ["RG-008", "Rice & Grains", "Semolina / Rava", "ரவை", "Ravai", "500 g", 38, 55, 20],
  ["RG-009", "Rice & Grains", "Little Millet", "சாமை", "Samai", "500 g", 65, 18, 12],
  ["RG-010", "Rice & Grains", "Foxtail Millet", "தினை", "Thinai", "500 g", 70, 9, 12],
  ["RG-011", "Rice & Grains", "Flattened Rice", "அவல்", "Aval", "500 g", 45, 33, 15],

  // Pulses & Dals
  ["PD-001", "Pulses & Dals", "Toor Dal", "துவரம் பருப்பு", "Thuvaram Paruppu", "1 kg", 165, 72, 25],
  ["PD-002", "Pulses & Dals", "Moong Dal", "பாசி பருப்பு", "Pasi Paruppu", "500 g", 78, 41, 20],
  ["PD-003", "Pulses & Dals", "Urad Dal", "உளுந்து", "Ulundhu", "500 g", 85, 58, 20],
  ["PD-004", "Pulses & Dals", "Chana Dal", "கடலை பருப்பு", "Kadalai Paruppu", "500 g", 62, 47, 20],
  ["PD-005", "Pulses & Dals", "Masoor Dal", "மைசூர் பருப்பு", "Mysore Paruppu", "500 g", 58, 16, 18],
  ["PD-006", "Pulses & Dals", "Black Chickpeas", "கொண்டைக்கடலை", "Kondaikadalai", "500 g", 55, 30, 15],
  ["PD-007", "Pulses & Dals", "Cowpea", "காரமணி", "Karamani", "500 g", 60, 24, 15],
  ["PD-008", "Pulses & Dals", "Green Gram Whole", "பச்சை பயறு", "Pachai Payaru", "500 g", 72, 27, 15],
  ["PD-009", "Pulses & Dals", "Peanuts", "நிலக்கடலை", "Nilakkadalai", "500 g", 90, 35, 18],

  // Oils & Ghee
  ["OG-001", "Oils & Ghee", "Gingelly / Sesame Oil", "நல்லெண்ணெய்", "Nallennai", "1 L", 285, 26, 12],
  ["OG-002", "Oils & Ghee", "Coconut Oil", "தேங்காய் எண்ணெய்", "Thengai Ennai", "500 ml", 180, 34, 15],
  ["OG-003", "Oils & Ghee", "Groundnut Oil", "கடலை எண்ணெய்", "Kadalai Ennai", "1 L", 210, 19, 12],
  ["OG-004", "Oils & Ghee", "Sunflower Oil", "சூரியகாந்தி எண்ணெய்", "Suriyakanthi Ennai", "1 L", 155, 62, 25],
  ["OG-005", "Oils & Ghee", "Ghee", "நெய்", "Nei", "500 ml", 340, 21, 10],
  ["OG-006", "Oils & Ghee", "Castor Oil", "விளக்கெண்ணெய்", "Vilakkennai", "200 ml", 85, 7, 8],

  // Spices & Powders
  ["SP-001", "Spices & Powders", "Chilli Powder", "மிளகாய் தூள்", "Milagai Thool", "250 g", 68, 55, 20],
  ["SP-002", "Spices & Powders", "Turmeric Powder", "மஞ்சள் தூள்", "Manjal Thool", "100 g", 32, 78, 25],
  ["SP-003", "Spices & Powders", "Coriander Powder", "மல்லி தூள்", "Malli Thool", "250 g", 52, 44, 20],
  ["SP-004", "Spices & Powders", "Sambar Powder", "சாம்பார் பொடி", "Sambar Podi", "200 g", 75, 39, 18],
  ["SP-005", "Spices & Powders", "Rasam Powder", "ரசம் பொடி", "Rasa Podi", "200 g", 80, 31, 18],
  ["SP-006", "Spices & Powders", "Idli Podi", "இட்லி பொடி", "Idli Podi", "200 g", 85, 26, 15],
  ["SP-007", "Spices & Powders", "Mustard Seeds", "கடுகு", "Kadugu", "100 g", 25, 88, 30],
  ["SP-008", "Spices & Powders", "Cumin Seeds", "சீரகம்", "Seeragam", "100 g", 42, 52, 20],
  ["SP-009", "Spices & Powders", "Fenugreek Seeds", "வெந்தயம்", "Vendhayam", "100 g", 22, 61, 20],
  ["SP-010", "Spices & Powders", "Asafoetida", "பெருங்காயம்", "Perungayam", "50 g", 58, 29, 12],
  ["SP-011", "Spices & Powders", "Black Pepper", "மிளகு", "Milagu", "100 g", 110, 23, 12],
  ["SP-012", "Spices & Powders", "Tamarind", "புளி", "Puli", "500 g", 95, 40, 18],
  ["SP-013", "Spices & Powders", "Curry Leaves", "கறிவேப்பிலை", "Kariveppilai", "50 g", 12, 0, 10],
  ["SP-014", "Spices & Powders", "Salt", "உப்பு", "Uppu", "1 kg", 22, 96, 30],
  ["SP-015", "Spices & Powders", "Dry Red Chilli", "வற்றல் மிளகாய்", "Vathal Milagai", "250 g", 78, 34, 15],

  // Vegetables
  ["VG-001", "Vegetables", "Onion", "வெங்காயம்", "Vengayam", "1 kg", 38, 85, 30],
  ["VG-002", "Vegetables", "Small Onion", "சின்ன வெங்காயம்", "Chinna Vengayam", "500 g", 55, 42, 20],
  ["VG-003", "Vegetables", "Tomato", "தக்காளி", "Thakkali", "1 kg", 32, 68, 30],
  ["VG-004", "Vegetables", "Potato", "உருளைக்கிழங்கு", "Urulaikizhangu", "1 kg", 42, 57, 25],
  ["VG-005", "Vegetables", "Drumstick", "முருங்கைக்காய்", "Murungakkai", "250 g", 35, 14, 15],
  ["VG-006", "Vegetables", "Brinjal", "கத்தரிக்காய்", "Kathirikkai", "500 g", 30, 26, 15],
  ["VG-007", "Vegetables", "Ladies Finger", "வெண்டைக்காய்", "Vendaikkai", "500 g", 35, 31, 15],
  ["VG-008", "Vegetables", "Carrot", "கேரட்", "Carrot", "500 g", 40, 38, 15],
  ["VG-009", "Vegetables", "Beans", "பீன்ஸ்", "Beans", "500 g", 45, 22, 15],
  ["VG-010", "Vegetables", "Snake Gourd", "புடலங்காய்", "Pudalangai", "500 g", 28, 17, 12],
  ["VG-011", "Vegetables", "Ash Gourd", "பூசணிக்காய்", "Poosanikkai", "1 kg", 35, 11, 10],
  ["VG-012", "Vegetables", "Green Chilli", "பச்சை மிளகாய்", "Pachai Milagai", "250 g", 20, 45, 15],
  ["VG-013", "Vegetables", "Ginger", "இஞ்சி", "Inji", "250 g", 32, 29, 12],
  ["VG-014", "Vegetables", "Garlic", "பூண்டு", "Poondu", "250 g", 48, 36, 15],
  ["VG-015", "Vegetables", "Coriander Leaves", "கொத்தமல்லி", "Kothamalli", "1 bunch", 10, 0, 20],
  ["VG-016", "Vegetables", "Coconut", "தேங்காய்", "Thengai", "1 pc", 42, 48, 20],

  // Fruits
  ["FR-001", "Fruits", "Poovan Banana", "பூவன் பழம்", "Poovan Pazham", "1 dozen", 55, 32, 15],
  ["FR-002", "Fruits", "Mango", "மாம்பழம்", "Maampazham", "1 kg", 120, 18, 12],
  ["FR-003", "Fruits", "Guava", "கொய்யாப்பழம்", "Koiyappazham", "500 g", 45, 21, 12],
  ["FR-004", "Fruits", "Papaya", "பப்பாளி", "Pappali", "1 kg", 40, 15, 10],
  ["FR-005", "Fruits", "Sapota", "சப்போட்டா", "Sapota", "500 g", 50, 9, 10],
  ["FR-006", "Fruits", "Orange", "ஆரஞ்சு", "Aranju", "1 kg", 85, 24, 12],
  ["FR-007", "Fruits", "Tender Coconut", "இளநீர்", "Ilaneer", "1 pc", 45, 40, 20],

  // Dairy
  ["DY-001", "Dairy", "Milk (Aavin)", "பால்", "Paal", "500 ml", 28, 110, 40],
  ["DY-002", "Dairy", "Curd", "தயிர்", "Thayir", "400 g", 32, 54, 25],
  ["DY-003", "Dairy", "Butter", "வெண்ணெய்", "Vennai", "100 g", 62, 27, 12],
  ["DY-004", "Dairy", "Paneer", "பன்னீர்", "Paneer", "200 g", 95, 13, 10],
  ["DY-005", "Dairy", "Buttermilk", "மோர்", "Moru", "200 ml", 15, 66, 30],

  // Snacks
  ["SN-001", "Snacks", "Murukku", "முறுக்கு", "Murukku", "200 g", 65, 43, 18],
  ["SN-002", "Snacks", "Mixture", "மிக்சர்", "Mixture", "250 g", 70, 37, 18],
  ["SN-003", "Snacks", "Thattai", "தட்டை", "Thattai", "200 g", 68, 25, 15],
  ["SN-004", "Snacks", "Banana Chips", "வாழக்காய் சிப்ஸ்", "Vazhakkai Chips", "200 g", 75, 30, 15],
  ["SN-005", "Snacks", "Athirasam", "அதிரசம்", "Athirasam", "250 g", 120, 12, 10],
  ["SN-006", "Snacks", "Seedai", "சீடை", "Seedai", "200 g", 70, 8, 12],
  ["SN-007", "Snacks", "Biscuits", "பிஸ்கட்", "Biscuit", "1 pkt", 30, 92, 30],

  // Beverages & Sweeteners
  ["BV-001", "Beverages & Sweeteners", "Tea Powder", "தேயிலை தூள்", "Theyilai Thool", "250 g", 115, 47, 20],
  ["BV-002", "Beverages & Sweeteners", "Filter Coffee Powder", "காபி பொடி", "Kaapi Podi", "200 g", 165, 33, 15],
  ["BV-003", "Beverages & Sweeteners", "Sugar", "சர்க்கரை", "Sarkkarai", "1 kg", 48, 88, 30],
  ["BV-004", "Beverages & Sweeteners", "Jaggery", "வெல்லம்", "Vellam", "500 g", 58, 41, 18],
  ["BV-005", "Beverages & Sweeteners", "Palm Sugar", "கருப்பட்டி", "Karuppatti", "250 g", 95, 14, 12],
  ["BV-006", "Beverages & Sweeteners", "Malted Health Drink", "சத்து பானம்", "Sathu Paanam", "500 g", 255, 11, 8],

  // Household & Cleaning
  ["HH-001", "Household & Cleaning", "Bath Soap", "குளியல் சோப்பு", "Kuliyal Soap", "1 pc", 42, 74, 30],
  ["HH-002", "Household & Cleaning", "Washing Powder", "சலவை தூள்", "Salavai Thool", "1 kg", 115, 36, 15],
  ["HH-003", "Household & Cleaning", "Dishwash Bar", "பாத்திரம் கழுவும் சோப்பு", "Pathiram Kazhuvum Soap", "1 pc", 28, 58, 25],
  ["HH-004", "Household & Cleaning", "Phenyl", "பினாயில்", "Phenyl", "500 ml", 68, 19, 12],
  ["HH-005", "Household & Cleaning", "Broom", "துடைப்பம்", "Thudaippam", "1 pc", 55, 16, 10],
  ["HH-006", "Household & Cleaning", "Agarbathi", "ஊதுபத்தி", "Oodhubathi", "1 pkt", 35, 62, 25],
  ["HH-007", "Household & Cleaning", "Camphor", "கற்பூரம்", "Karpooram", "50 g", 45, 28, 12],
  ["HH-008", "Household & Cleaning", "Matchbox", "தீப்பெட்டி", "Theeppetti", "1 pc", 2, 0, 50],
];

export const kiranaCatalog: KiranaCatalogItem[] = rows.map(
  ([sku, category, name, nameTamil, tanglish, unit, priceRupees, stockQty, reorderLevel]) => ({
    sku,
    category,
    name,
    nameTamil,
    tanglish,
    unit,
    priceRupees,
    stockQty,
    reorderLevel,
  }),
);
