// Static and procedural data banks for Bangladeshi retail business seed.
const MALE_FIRST_NAMES = [
    "Tanvir", "Sabbir", "Arif", "Hasan", "Mehedi", "Fahim", "Rakib", "Shakil",
    "Mahmud", "Imran", "Nayeem", "Saiful", "Ashiq", "Farhan", "Riyad", "Kamrul",
    "Zubair", "Nasir", "Tariq", "Sohan", "Biplob", "Shuvo", "Alamin", "Anik",
    "Rashed", "Shafiq", "Towhid", "Munir", "Habib", "Jamil", "Rony", "Sujon",
    "Nahid", "Siam", "Shahriar", "Morshed", "Mustafiz", "Tamim", "Taskin", "Liton"
];

const FEMALE_FIRST_NAMES = [
    "Nusrat", "Sadia", "Fatima", "Ayesha", "Sumaiya", "Tanjina", "Sharmin", "Farzana",
    "Tasnim", "Israt", "Jannat", "Samia", "Naznin", "Ruma", "Mithila", "Mehnaz",
    "Nadia", "Sultana", "Afroza", "Sabrina", "Fariha", "Anika", "Mim", "Priya",
    "Tamanna", "Lamia", "Bushra", "Humaira", "Mahfuza", "Shirin", "Bristi", "Nafisa",
    "Sanjida", "Zannatul", "Moriom", "Rokeya", "Suraiya", "Tahmina", "Nasreen", "Rupa"
];

const LAST_NAMES = [
    "Ahmed", "Rahman", "Hossain", "Chowdhury", "Khan", "Islam", "Haque", "Alam",
    "Uddin", "Ali", "Karim", "Sarker", "Mia", "Akter", "Begum", "Khatun", "Talukder",
    "Bhuiyan", "Miah", "Siddique", "Howlader", "Majumder", "Dewan", "Kazi", "Mallick"
];

const STREET_PREFIXES = [
    "House 12, Road 4", "House 45, Road 7", "Plot 8, Block C", "House 102, Road 11",
    "Flat 4B, Green Tower", "Holding 24/A", "Avenue 3, Sector 4", "Block D, Lane 2",
    "House 15/2, Lake Circus", "Holding 78, Central Road", "House 33, Block B", "Sector 11, Road 20",
    "House 67, Ward 5", "North Circular Road 14", "Station Road 88", "College Road 19"
];

const CATEGORIES_DATA = [
    { code: "CLOTH", name: "Clothing & Apparel", desc: "Men, women and kids casual and formal wear" },
    { code: "SKIN", name: "Skincare & Cosmetics", desc: "Creams, lotions, serums and beauty care" },
    { code: "BAGS", name: "Bags & Leather", desc: "Handbags, backpacks, wallets and travel gear" },
    { code: "FOOT", name: "Footwear", desc: "Casual shoes, sandals and formal footwear" },
    { code: "JEWEL", name: "Jewelry & Accessories", desc: "Watches, necklaces, earrings and rings" },
    { code: "BABY", name: "Baby & Kids Essentials", desc: "Baby care, toys and infant accessories" },
    { code: "HOME", name: "Home Decor & Living", desc: "Cushions, bedsheets, mats and decorative pieces" },
    { code: "KITCH", name: "Kitchen & Dining", desc: "Tableware, storage containers and kitchen gadgets" },
    { code: "TECH", name: "Gadgets & Accessories", desc: "Phone cases, cables, adapters and chargers" },
    { code: "PERF", name: "Fragrances & Scents", desc: "Attar, body mists, perfumes and deodorants" },
    { code: "STAT", name: "Stationery & Craft", desc: "Notebooks, planners, art supplies and pens" },
    { code: "PACK", name: "Packaging & Supplies", desc: "Boxes, tape, bubble wrap, poly bags and flyers" }
];

const SUB_CATEGORIES_DATA = [
    // Clothing
    { cat: "CLOTH", code: "CL-TSHIRT", name: "T-Shirts & Polos" },
    { cat: "CLOTH", code: "CL-PANJABI", name: "Panjabis & Kurtas" },
    { cat: "CLOTH", code: "CL-SAREE", name: "Sarees & Ethnic Wear" },
    { cat: "CLOTH", code: "CL-DENIM", name: "Jeans & Trousers" },
    { cat: "CLOTH", code: "CL-HOODIE", name: "Jackets & Hoodies" },
    // Skincare
    { cat: "SKIN", code: "SK-FACEWASH", name: "Face Washes & Cleansers" },
    { cat: "SKIN", code: "SK-SERUM", name: "Serums & Essences" },
    { cat: "SKIN", code: "SK-MOIST", name: "Moisturizers & Day Creams" },
    { cat: "SKIN", code: "SK-SUN", name: "Sunscreens & Sunblocks" },
    { cat: "SKIN", code: "SK-MASK", name: "Sheet Masks & Clay Masks" },
    // Bags
    { cat: "BAGS", code: "BG-TOTE", name: "Tote Bags & Handbags" },
    { cat: "BAGS", code: "BG-BACKPACK", name: "Backpacks & Laptop Bags" },
    { cat: "BAGS", code: "BG-WALLET", name: "Wallets & Card Holders" },
    { cat: "BAGS", code: "BG-CROSS", name: "Crossbody & Sling Bags" },
    // Footwear
    { cat: "FOOT", code: "FT-SNEAKER", name: "Sneakers & Casuals" },
    { cat: "FOOT", code: "FT-SANDAL", name: "Sandals & Slides" },
    { cat: "FOOT", code: "FT-FORMAL", name: "Formal Shoes & Loafers" },
    // Jewelry
    { cat: "JEWEL", code: "JW-WATCH", name: "Watches" },
    { cat: "JEWEL", code: "JW-EARRING", name: "Earrings & Studs" },
    { cat: "JEWEL", code: "JW-NECKLACE", name: "Necklaces & Pendants" },
    { cat: "JEWEL", code: "JW-RING", name: "Rings & Bracelets" },
    // Baby
    { cat: "BABY", code: "BB-CLOTHES", name: "Baby Clothes & Rompers" },
    { cat: "BABY", code: "BB-CARE", name: "Baby Bath & Skincare" },
    { cat: "BABY", code: "BB-TOY", name: "Soft Toys & Rattles" },
    // Home
    { cat: "HOME", code: "HM-BED", name: "Bedsheets & Covers" },
    { cat: "HOME", code: "HM-CUSHION", name: "Cushion Covers & Throws" },
    { cat: "HOME", code: "HM-DECOR", name: "Wall Art & Planters" },
    // Kitchen
    { cat: "KITCH", code: "KT-MUG", name: "Ceramic Mugs & Cups" },
    { cat: "KITCH", code: "KT-BOTTLE", name: "Water Bottles & Flasks" },
    { cat: "KITCH", code: "KT-ORG", name: "Organizers & Baskets" },
    // Tech
    { cat: "TECH", code: "TC-CASE", name: "Phone Cases & Covers" },
    { cat: "TECH", code: "TC-CABLE", name: "Fast Charging Cables" },
    { cat: "TECH", code: "TC-STAND", name: "Desk Phone & Laptop Stands" },
    // Fragrances
    { cat: "PERF", code: "PF-ATTAR", name: "Premium Attar Oils" },
    { cat: "PERF", code: "PF-MIST", name: "Body Mists & Sprays" },
    { cat: "PERF", code: "PF-EDP", name: "Eau De Parfum" },
    // Stationery
    { cat: "STAT", code: "ST-NOTE", name: "Daily Planners & Notebooks" },
    { cat: "STAT", code: "ST-PEN", name: "Gel Pens & Markers" },
    // Packaging (For internal business use)
    { cat: "PACK", code: "PK-BOX", name: "Corrugated Shipping Boxes" },
    { cat: "PACK", code: "PK-POLY", name: "Courier Security Poly Bags" },
    { cat: "PACK", code: "PK-TAPE", name: "Branded Packaging Tape" }
];

const BRANDS_DATA = [
    { name: "Urban Stitch", country: "BD" },
    { name: "Dhaka Loom", country: "BD" },
    { name: "Glow Rituals", country: "KR" },
    { name: "Pure Botanic", country: "TH" },
    { name: "Velvet Bloom", country: "BD" },
    { name: "Bengal Carry", country: "BD" },
    { name: "Nomad Leather", country: "BD" },
    { name: "Apex Step", country: "BD" },
    { name: "Stride Walk", country: "VN" },
    { name: "Aura Spark", country: "BD" },
    { name: "Little Sprout", country: "BD" },
    { name: "Cozy Haven", country: "BD" },
    { name: "Artisan Clay", country: "BD" },
    { name: "TechArmor", country: "CN" },
    { name: "Scent Crafts", country: "AE" },
    { name: "Oud Horizon", country: "BD" },
    { name: "Doodle Pad", country: "BD" },
    { name: "PackPro Supplies", country: "BD" },
    { name: "Nordic Wave", country: "SE" },
    { name: "Komorebi Style", country: "JP" },
    { name: "Silk Route", country: "BD" },
    { name: "Luxe Thread", country: "IN" },
    { name: "Hydro Shield", country: "TW" },
    { name: "EcoWrap BD", country: "BD" },
    { name: "Prime Kraft", country: "BD" }
];

const SUPPLIERS_DATA = [
    { name: "Bengal Garments Sourcing Ltd", person: "Kamrul Islam", phone: "01711000001", email: "bengalgarments@testcorp.internal", city: "Gazipur" },
    { name: "Dhaka Textile Traders", person: "Sharif Ahmed", phone: "01711000002", email: "dhakatextile@testcorp.internal", city: "Narayanganj" },
    { name: "Asian Beauty Imports", person: "Tanvir Rahman", phone: "01711000003", email: "asianbeauty@testcorp.internal", city: "Dhaka" },
    { name: "Seoul Glow Direct", person: "Min-ho Park", phone: "01711000004", email: "seoulglow@testcorp.internal", city: "Seoul" },
    { name: "Chattogram Leather Works", person: "Nasir Uddin", phone: "01711000005", email: "ctgleather@testcorp.internal", city: "Chattogram" },
    { name: "Hazaribagh Bag House", person: "Rafiq Miah", phone: "01711000006", email: "hazaribaghbags@testcorp.internal", city: "Dhaka" },
    { name: "Apex Footwear Wholesalers", person: "Enamul Haque", phone: "01711000007", email: "apexwholesale@testcorp.internal", city: "Dhaka" },
    { name: "Eastern Crafts & Ornaments", person: "Subrata Roy", phone: "01711000008", email: "easterncrafts@testcorp.internal", city: "Dhaka" },
    { name: "Little Angels Sourcing", person: "Sultana Begum", phone: "01711000009", email: "littleangels@testcorp.internal", city: "Dhaka" },
    { name: "Heritage Home Living", person: "Mahmud Hasan", phone: "01711000010", email: "heritagehome@testcorp.internal", city: "Comilla" },
    { name: "Clay & Glass Ceramic Depot", person: "Babul Hossain", phone: "01711000011", email: "claydepot@testcorp.internal", city: "Dhaka" },
    { name: "Shenzhen Micro Tech Co", person: "Wei Zhang", phone: "01711000012", email: "shenzhenmicro@testcorp.internal", city: "Shenzhen" },
    { name: "Al-Barakah Fragrance House", person: "Sheikh Farooq", phone: "01711000013", email: "albarakah@testcorp.internal", city: "Sylhet" },
    { name: "Bangla Press & Stationery", person: "Mustafa Kamal", phone: "01711000014", email: "banglapress@testcorp.internal", city: "Dhaka" },
    { name: "SafePack Carton Industries", person: "Anwar Parvez", phone: "01711000015", email: "safepack@testcorp.internal", city: "Tongi" },
    { name: "Poly Polymer Suppliers BD", person: "Jalal Uddin", phone: "01711000016", email: "polypolymer@testcorp.internal", city: "Keraniganj" },
    { name: "Meghna Import Ventures", person: "Shakil Chowdhury", phone: "01711000017", email: "meghnaimports@testcorp.internal", city: "Chattogram" },
    { name: "Cotton Craft Fabrics", person: "Ziaur Rahman", phone: "01711000018", email: "cottoncraft@testcorp.internal", city: "Narsingdi" },
    { name: "Boutique Accessories Hub", person: "Fariha Karim", phone: "01711000019", email: "boutiquehub@testcorp.internal", city: "Dhaka" },
    { name: "Metro Retail Distribution", person: "Imtiaz Morshed", phone: "01711000020", email: "metroretail@testcorp.internal", city: "Dhaka" }
];

const WAREHOUSES_DATA = [
    { code: "WH-MAIN", name: "Tejgaon Central Hub", address: "14 Tejgaon I/A, Dhaka", special: "Main fulfillment and dispatch hub" },
    { code: "WH-MIRPUR", name: "Mirpur Secondary Depot", address: "Plot 3, Mirpur 11, Dhaka", special: "Overflow storage and packaging stock" },
    { code: "WH-OUTLET", name: "Dhanmondi Flagship Store", address: "Road 27, Dhanmondi, Dhaka", special: "POS counter and instant pickup stock" }
];

const AISLES_DATA = [
    // WH-MAIN (6 aisles)
    { whCode: "WH-MAIN", code: "A-01", name: "Aisle 1 - Men Apparel", type: "rack", capacity: 400 },
    { whCode: "WH-MAIN", code: "A-02", name: "Aisle 2 - Women & Ethnic", type: "rack", capacity: 400 },
    { whCode: "WH-MAIN", code: "A-03", name: "Aisle 3 - Skincare & Fragrances", type: "shelf", capacity: 600 },
    { whCode: "WH-MAIN", code: "A-04", name: "Aisle 4 - Bags & Shoes", type: "rack", capacity: 300 },
    { whCode: "WH-MAIN", code: "A-05", name: "Aisle 5 - Home & Kitchenware", type: "shelf", capacity: 350 },
    { whCode: "WH-MAIN", code: "A-06", name: "Aisle 6 - Dispatch Staging & Boxes", type: "box", capacity: 500 },
    // WH-MIRPUR (3 aisles)
    { whCode: "WH-MIRPUR", code: "B-01", name: "Aisle 1 - Bulk Apparel Overflow", type: "rack", capacity: 600 },
    { whCode: "WH-MIRPUR", code: "B-02", name: "Aisle 2 - Packaging Materials & Poly", type: "box", capacity: 800 },
    { whCode: "WH-MIRPUR", code: "B-03", name: "Aisle 3 - Tech & Accessories Stock", type: "cupboard", capacity: 500 },
    // WH-OUTLET (3 aisles)
    { whCode: "WH-OUTLET", code: "C-01", name: "Front Shelf - Featured Display", type: "showcase", capacity: 200 },
    { whCode: "WH-OUTLET", code: "C-02", name: "Back Storage - Ready Stock", type: "shelf", capacity: 300 },
    { whCode: "WH-OUTLET", code: "C-03", name: "Counter Storage - Fast Movers", type: "shelf", capacity: 250 }
];

const ORDER_SOURCES_DATA = [
    { platform: "Facebook", name: "StockFlow Official Facebook Page" },
    { platform: "Instagram", name: "StockFlow Lifestyle Instagram" },
    { platform: "WhatsApp", name: "StockFlow Direct WhatsApp Support" },
    { platform: "Website", name: "StockFlow Web Store" },
    { platform: "TikTok", name: "StockFlow Shop TikTok Channel" },
    { platform: "Other", name: "Walk-in & Phone Inquiries" }
];

const PARTNERS_DATA = [
    { name: "Sabrina Lifestyle Vlogs", type: "Person", platforms: ["Instagram", "Facebook"], handle: "@sabrina.vlogs", method: "bKash" },
    { name: "Rafid Tech Reviews BD", type: "Person", platforms: ["YouTube", "Facebook"], handle: "@rafidreviews", method: "bKash" },
    { name: "Dhaka Fashion Diary", type: "Page", platforms: ["Facebook", "Instagram"], handle: "@dhakafashiondiary", method: "Bank" },
    { name: "Glow with Anika", type: "Person", platforms: ["Instagram", "TikTok"], handle: "@anika_glow", method: "bKash" },
    { name: "Chic Wear Collection", type: "Business", platforms: ["Facebook"], handle: "@chicwearbd", method: "Bank" },
    { name: "Trendsetter Mim", type: "Person", platforms: ["TikTok", "Instagram"], handle: "@mim_trends", method: "Nagad" },
    { name: "Urban Gentleman BD", type: "Page", platforms: ["Instagram", "Facebook"], handle: "@urbangent_bd", method: "Bank" },
    { name: "Beauty Bites with Farah", type: "Person", platforms: ["Instagram"], handle: "@farah_beauty", method: "bKash" },
    { name: "Deshi Artisan Spotlight", type: "Page", platforms: ["Facebook"], handle: "@deshiartisan", method: "Cash" },
    { name: "Style Spectrum", type: "Business", platforms: ["Instagram", "Facebook"], handle: "@stylespectrum", method: "Bank" },
    { name: "Nafisa OOTD", type: "Person", platforms: ["Instagram", "TikTok"], handle: "@nafisa_ootd", method: "bKash" },
    { name: "The Daily Scent Guide", type: "Page", platforms: ["Facebook", "Instagram"], handle: "@dailyscent", method: "Nagad" }
];

const CAMPAIGNS_DATA = [
    { no: "DEV-CMP-2511-01", name: "Winter Cozy Drop 2025", type: "InfluencerPost", status: "Completed", startDaysAgo: 340, endDaysAgo: 310, spend: 35000 },
    { no: "DEV-CMP-2512-01", name: "Year-End Mega Festive Sale", type: "BoostedAd", status: "Completed", startDaysAgo: 300, endDaysAgo: 285, spend: 50000 },
    { no: "DEV-CMP-2601-01", name: "New Year Glow Skincare Launch", type: "Seeding", status: "Completed", startDaysAgo: 270, endDaysAgo: 250, spend: 28000 },
    { no: "DEV-CMP-2602-01", name: "Spring Bloom Ethnic Wear", type: "DiscountOffer", status: "Completed", startDaysAgo: 240, endDaysAgo: 220, spend: 20000 },
    { no: "DEV-CMP-2603-01", name: "Ramadan Essentials Preview", type: "BoostedAd", status: "Completed", startDaysAgo: 210, endDaysAgo: 190, spend: 45000 },
    { no: "DEV-CMP-2603-02", name: "Eid Collection Influencer Blitz", type: "InfluencerPost", status: "Completed", startDaysAgo: 190, endDaysAgo: 165, spend: 75000 },
    { no: "DEV-CMP-2604-01", name: "Post-Eid Clearance Flash Sale", type: "DiscountOffer", status: "Completed", startDaysAgo: 160, endDaysAgo: 145, spend: 18000 },
    { no: "DEV-CMP-2605-01", name: "Summer Breeze Casuals Drop", type: "Live", status: "Completed", startDaysAgo: 140, endDaysAgo: 120, spend: 32000 },
    { no: "DEV-CMP-2606-01", name: "Monsoon Moisture & Hydration", type: "BoostedAd", status: "Completed", startDaysAgo: 110, endDaysAgo: 90, spend: 22000 },
    { no: "DEV-CMP-2607-01", name: "Independence Special Week", type: "PageShare", status: "Completed", startDaysAgo: 85, endDaysAgo: 75, spend: 15000 },
    { no: "DEV-CMP-2608-01", name: "Back to Campus Bags & Gear", type: "InfluencerPost", status: "Completed", startDaysAgo: 70, endDaysAgo: 50, spend: 40000 },
    { no: "DEV-CMP-2609-01", name: "Autumn Fragrance Festival", type: "Seeding", status: "Completed", startDaysAgo: 45, endDaysAgo: 30, spend: 25000 },
    { no: "DEV-CMP-2610-01", name: "Puja Celebrations Promo", type: "BoostedAd", status: "Live", startDaysAgo: 20, endDaysAgo: -5, spend: 30000 },
    { no: "DEV-CMP-2610-02", name: "Pre-Winter Outerwear Teaser", type: "BoostedAd", status: "Planned", startDaysAgo: -5, endDaysAgo: -25, spend: 35000 },
    { no: "DEV-CMP-2608-02", name: "Influencer Summer Hangout (Cancelled)", type: "InfluencerPost", status: "Cancelled", startDaysAgo: 60, endDaysAgo: 50, spend: 0 }
];

module.exports = {
    MALE_FIRST_NAMES,
    FEMALE_FIRST_NAMES,
    LAST_NAMES,
    STREET_PREFIXES,
    CATEGORIES_DATA,
    SUB_CATEGORIES_DATA,
    BRANDS_DATA,
    SUPPLIERS_DATA,
    WAREHOUSES_DATA,
    AISLES_DATA,
    ORDER_SOURCES_DATA,
    PARTNERS_DATA,
    CAMPAIGNS_DATA
};
