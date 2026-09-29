require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Category = require('../models/Category');
const Equipment = require('../models/Equipment');
const EquipmentType = require('../models/EquipmentType');
const EquipmentAsset = require('../models/EquipmentAsset');
const Package = require('../models/Package');
const connectDatabase = require('../config/db');
const { migrateLegacyInventory, syncAssetForLegacy } = require('../services/inventory');

const cities = [
  { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', pincode: '560001', coordinates: [77.5946, 12.9716] },
  { city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', pincode: '600001', coordinates: [80.2707, 13.0827] },
  { city: 'Mumbai', district: 'Mumbai City', state: 'Maharashtra', pincode: '400001', coordinates: [72.8777, 19.076] },
  { city: 'New Delhi', district: 'New Delhi', state: 'Delhi', pincode: '110001', coordinates: [77.209, 28.6139] },
  { city: 'Pune', district: 'Pune', state: 'Maharashtra', pincode: '411001', coordinates: [73.8567, 18.5204] },
  { city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', pincode: '500001', coordinates: [78.4867, 17.385] },
  { city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', pincode: '700001', coordinates: [88.3639, 22.5726] }
];

const categories = [
  { name: 'Cameras & Lenses', slug: 'cameras-lenses', description: 'Cameras, lenses, and photography gear', image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1000&q=80', products: [
    ['Canon EOS R50 Creator Kit', 'Canon', 1100, 68000, 500, 'Shoot interviews and create crisp videos', 'कैमरा वीडियो फोटोग्राफी', 'கேமரா வீடியோ புகைப்படம்'],
    ['Sony Alpha 7 IV Camera', 'Sony', 1800, 185000, 1500, 'Capture portraits and professional video', 'फोटो वीडियो शूट', 'புகைப்படம் வீடியோ படப்பிடிப்பு'],
    ['Nikon Z6 III Camera Kit', 'Nikon', 1600, 170000, 1200, 'Capture events in low light', 'इवेंट फोटोग्राफी', 'நிகழ்வு புகைப்படம்'],
    ['Sony FE 24-70mm Lens', 'Sony', 750, 98000, 800, 'Photograph events with a versatile zoom lens', 'फोटो इवेंट लेंस', 'புகைப்பட நிகழ்வு லென்ஸ்'],
    ['DJI Mini 4 Pro Drone Kit', 'DJI', 1300, 92000, 1000, 'Capture aerial photos and travel video', 'ड्रोन हवाई वीडियो', 'ட்ரோன் வான்வழி வீடியோ']
  ] },
  { name: 'Power Tools', slug: 'power-tools', description: 'Tools for building, repair, and renovation', image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=1000&q=80', products: [
    ['Bosch 18V Drill Driver Kit', 'Bosch', 450, 14000, 1000, 'Drill and fasten for home repairs', 'ड्रिल मरम्मत निर्माण', 'துளையிடு பழுது கட்டுமானம்'],
    ['Makita Circular Saw Kit', 'Makita', 650, 22000, 1500, 'Cut timber for carpentry and renovation', 'लकड़ी काटना बढ़ईगीरी', 'மரம் வெட்டுதல் தச்சு வேலை'],
    ['DeWalt Rotary Hammer', 'DeWalt', 800, 32000, 2000, 'Drill masonry and install anchors', 'दीवार ड्रिल निर्माण', 'சுவர் துளையிடு கட்டுமானம்'],
    ['Bosch Angle Grinder', 'Bosch', 350, 9500, 800, 'Cut and grind metal for repair work', 'धातु काटना पीसना', 'உலோகம் வெட்டு அரை'],
    ['Makita Impact Driver', 'Makita', 400, 12500, 900, 'Drive fasteners for assembly projects', 'स्क्रू लगाना असेंबली', 'திருகு பொருத்து அசெம்பிளி']
  ] },
  { name: 'Camping & Outdoors', slug: 'camping-outdoors', description: 'Camping equipment and outdoor essentials', image: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=1000&q=80', products: [
    ['Quechua 4-Person Camping Tent', 'Quechua', 600, 16000, 1200, 'Set up a comfortable family campsite', 'कैंपिंग टेंट आउटडोर', 'முகாம் கூடாரம் வெளிப்புறம்'],
    ['Trek 65L Hiking Backpack', 'Forclaz', 300, 11000, 800, 'Pack for a multi-day hiking trip', 'ट्रेकिंग बैग यात्रा', 'மலையேற்ற பை பயணம்'],
    ['Coleman Portable Camping Stove', 'Coleman', 350, 9000, 600, 'Cook meals at a campsite', 'कैंप खाना पकाना', 'முகாமில் சமையல்'],
    ['Sleeping Bag and Mat Set', 'Quechua', 250, 6500, 500, 'Sleep comfortably on an outdoor trip', 'स्लीपिंग बैग आउटडोर', 'தூக்கப் பை வெளிப்புறம்'],
    ['Yeti Roadie 24 Cooler', 'Yeti', 450, 18000, 1200, 'Keep food and drinks cool on a trip', 'कूलर यात्रा पिकनिक', 'குளிரூட்டி பயணம் சுற்றுலா']
  ] },
  { name: 'Audio & Music', slug: 'audio-music', description: 'Audio equipment and musical instruments', image: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1000&q=80', products: [
    ['Shure Podcast Microphone Kit', 'Shure', 600, 28000, 1500, 'Record a podcast or voiceover', 'पॉडकास्ट रिकॉर्डिंग माइक', 'பாட்காஸ்ட் பதிவு மைக்'],
    ['Yamaha Digital Piano 88-Key', 'Yamaha', 900, 58000, 2500, 'Rehearse and perform keyboard music', 'पियानो संगीत अभ्यास', 'பியானோ இசை பயிற்சி'],
    ['JBL Portable PA Speaker', 'JBL', 1200, 72000, 3000, 'Provide sound for a gathering or event', 'कार्यक्रम स्पीकर ध्वनि', 'நிகழ்வு ஒலிபெருக்கி'],
    ['Fender Player Electric Guitar', 'Fender', 850, 65000, 3000, 'Practice and perform live music', 'गिटार संगीत कार्यक्रम', 'கிட்டார் இசை நிகழ்ச்சி'],
    ['Focusrite Studio Recording Bundle', 'Focusrite', 700, 42000, 2000, 'Record music and vocals at home', 'स्टूडियो संगीत रिकॉर्ड', 'ஸ்டுடியோ இசை பதிவு']
  ] },
  { name: 'Event Equipment', slug: 'event-equipment', description: 'Equipment for parties, events, and gatherings', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1000&q=80', products: [
    ['Epson Full HD Event Projector', 'Epson', 1400, 95000, 4000, 'Project presentations and films', 'प्रोजेक्टर प्रस्तुति फिल्म', 'புரொஜெக்டர் விளக்கக்காட்சி படம்'],
    ['Portable LED Uplight Set', 'Pioneer', 900, 54000, 2500, 'Light a stage or celebration space', 'स्टेज लाइट पार्टी', 'மேடை விளக்கு விருந்து'],
    ['Folding Event Table Set', 'Lifetime', 500, 24000, 1500, 'Arrange seating for an event', 'इवेंट टेबल कुर्सी', 'நிகழ்வு மேசை நாற்காலி'],
    ['Wireless Event Microphone Pair', 'Sennheiser', 800, 49000, 2500, 'Amplify speakers at a gathering', 'कार्यक्रम वायरलेस माइक', 'நிகழ்வு வயர்லெஸ் மைக்'],
    ['Backdrop and Stand Kit', 'Neewer', 450, 18000, 1000, 'Create a photo or presentation backdrop', 'फोटो बैकड्रॉप कार्यक्रम', 'புகைப்பட பின்னணி நிகழ்வு']
  ] },
  { name: 'Sports & Fitness', slug: 'sports-fitness', description: 'Fitness, sports, and recreation equipment', image: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=1000&q=80', products: [
    ['Adjustable Dumbbell Pair', 'Bowflex', 550, 38000, 2000, 'Train strength at home', 'डंबल व्यायाम फिटनेस', 'டம்பல் உடற்பயிற்சி உடற்தகுதி'],
    ['Decathlon Road Bicycle', 'Triban', 800, 52000, 2500, 'Ride for fitness or explore the city', 'साइकिल राइडिंग फिटनेस', 'மிதிவண்டி சவாரி உடற்பயிற்சி'],
    ['Tennis Racket and Ball Set', 'Wilson', 300, 16000, 1000, 'Play a match at your local court', 'टेनिस खेल रैकेट', 'டென்னிஸ் விளையாட்டு ராக்கெட்'],
    ['Yoga Mat and Block Set', 'Manduka', 200, 9000, 500, 'Practice yoga and mobility', 'योग फिटनेस अभ्यास', 'யோகா உடற்பயிற்சி பயிற்சி'],
    ['Foldable Treadmill', 'PowerMax', 1000, 68000, 4000, 'Run and walk indoors', 'दौड़ ट्रेडमिल फिटनेस', 'ஓட்டம் டிரெட்மில் உடற்பயிற்சி']
  ] },
  { name: 'Home & Garden', slug: 'home-garden', description: 'Useful equipment for home projects and garden care', image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1000&q=80', products: [
    ['Karcher Pressure Washer', 'Karcher', 650, 28000, 1500, 'Wash patios, vehicles, and outdoor surfaces', 'प्रेशर वॉशर सफाई घर', 'அழுத்த சுத்திகரிப்பு வீடு'],
    ['Bosch Electric Hedge Trimmer', 'Bosch', 450, 16000, 1000, 'Trim hedges and maintain a garden', 'बगीचा हेज ट्रिमर', 'தோட்டம் செடி வெட்டி'],
    ['Wet and Dry Shop Vacuum', 'Karcher', 500, 22000, 1200, 'Clean up after a home project', 'घर सफाई वैक्यूम', 'வீடு சுத்தம் வெற்றிடம்'],
    ['Electric Lawn Mower', 'Stihl', 900, 42000, 2500, 'Maintain a lawn and garden', 'लॉन घास काटना बगीचा', 'புல்வெளி வெட்டு தோட்டம்'],
    ['Ladder and Tool Trolley Set', 'Kapro', 350, 14000, 800, 'Reach safely and move tools for repairs', 'सीढ़ी औजार मरम्मत', 'ஏணி கருவி பழுது']
  ] },
  { name: 'Construction & Industrial', slug: 'construction-industrial', description: 'Reliable equipment for construction and site work', image: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1000&q=80', products: [
    ['Honda Portable Generator 3kVA', 'Honda', 1800, 110000, 6000, 'Power equipment at a worksite', 'जनरेटर निर्माण साइट बिजली', 'ஜெனரேட்டர் கட்டுமான தளம் மின்சாரம்'],
    ['Bosch Laser Distance Meter', 'Bosch', 400, 18000, 900, 'Measure rooms and site layouts', 'लेजर माप निर्माण', 'லேசர் அளவு கட்டுமானம்'],
    ['Concrete Vibrator and Poker', 'Ajax', 1200, 65000, 3500, 'Consolidate concrete for a pour', 'कंक्रीट निर्माण वाइब्रेटर', 'கான்கிரீட் கட்டுமான அதிர்வி'],
    ['Scaffold Tower Section Set', 'Alufase', 1500, 85000, 5000, 'Work safely at height on a project', 'मचान ऊंचाई निर्माण', 'சாரக்கட்டு உயரம் கட்டுமானம்'],
    ['Welding Inverter and Mask Kit', 'Ador', 950, 48000, 3000, 'Weld and repair metal components', 'वेल्डिंग धातु मरम्मत', 'வெல்டிங் உலோகம் பழுது']
  ] }
];

const legacyDemoNames = [
  'Canon EOS R6 Mark II', 'Sony A7 IV + 24-70mm', 'DJI Mini 4 Pro Fly More',
  'Sigma 35mm f/1.4 Art', 'Makita 18V Drill Kit', 'DeWalt Circular Saw',
  'Bosch Rotary Hammer', 'Festool Track Saw Set', 'REI Half Dome 4 Tent',
  'Osprey Atmos AG 65 Pack', 'Yeti Tundra 65 Cooler', 'MSR Hubba Hubba NX 2',
  'Shure SM7B Podcast Kit', 'Yamaha P-125 Digital Piano', 'JBL EON One Compact PA',
  'Fender Player Stratocaster', 'Epson Pro EX11000 Projector', 'Bowflex SelectTech 552 Set'
];
const legacyDemoPackageNames = [
  'Power Tool Starter Kit', 'Creator Essentials Kit', 'Outdoor Weekend Kit', 'Event Presentation Kit'
];

const categoryTranslations = {
  'cameras-lenses': ['कैमरा और लेंस', 'கேமரா மற்றும் லென்ஸ்'],
  'power-tools': ['बिजली के औज़ार', 'மின்சார கருவிகள்'],
  'camping-outdoors': ['कैंपिंग और आउटडोर', 'முகாம் மற்றும் வெளிப்புறம்'],
  'audio-music': ['ऑडियो और संगीत', 'ஒலி மற்றும் இசை'],
  'event-equipment': ['कार्यक्रम उपकरण', 'நிகழ்வு உபகரணங்கள்'],
  'sports-fitness': ['खेल और फिटनेस', 'விளையாட்டு மற்றும் உடற்பயிற்சி'],
  'home-garden': ['घर और बगीचा', 'வீடு மற்றும் தோட்டம்'],
  'construction-industrial': ['निर्माण और औद्योगिक', 'கட்டுமானம் மற்றும் தொழில்துறை']
};

const categoryCodes = {
  'cameras-lenses': 'CMR',
  'power-tools': 'PWR',
  'camping-outdoors': 'CMP',
  'audio-music': 'AUD',
  'event-equipment': 'EVT',
  'sports-fitness': 'SPT',
  'home-garden': 'HME',
  'construction-industrial': 'CNS'
};

function toSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function seed() {
  await connectDatabase();
  const accounts = [
    { name: 'RentalHub Demo Customer', email: 'customer@rentalhub.com', password: 'Customer@123', role: 'customer', phone: '+91 98765 43210' },
    { name: 'RentalHub Demo Owner', email: 'owner@rentalhub.com', password: 'Owner@123', role: 'owner', ownerVerified: true, phone: '+91 98765 43211' },
    { name: 'RentalHub Demo Admin', email: 'admin@rentalhub.com', password: 'Admin@123', role: 'admin', phone: '+91 98765 43212' }
  ];
  const users = {};
  for (const data of accounts) {
    let user = await User.findOne({ email: data.email });
    if (!user) user = await User.create(data);
    else {
      user.name = data.name;
      user.password = data.password;
      user.role = data.role;
      user.ownerVerified = Boolean(data.ownerVerified);
      user.verificationStatus = data.ownerVerified ? 'verified' : 'pending';
      user.phone = data.phone;
      user.active = true;
      await user.save();
    }
    users[data.role] = user;
  }

  const categoryMap = {};
  for (const category of categories) {
    const [hindi, tamil] = categoryTranslations[category.slug];
    categoryMap[category.name] = await Category.findOneAndUpdate(
      { slug: category.slug },
      {
        $set: {
          name: category.name,
          description: category.description,
          image: category.image,
          names: [{ lang: 'en', value: category.name }, { lang: 'hi', value: hindi }, { lang: 'ta', value: tamil }],
          aliases: [category.name, hindi, tamil],
          active: true
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  const seededAssets = new Map();
  for (const category of categories) {
    const categoryDoc = categoryMap[category.name];
    for (let productIndex = 0; productIndex < category.products.length; productIndex += 1) {
      const [name, brand, dailyRate, replacementValue, depositAmount, task, hindi, tamil] = category.products[productIndex];
      const slug = `${category.slug}-${toSlug(name)}`;
      const type = await EquipmentType.findOneAndUpdate(
        { category: categoryDoc._id, slug },
        {
          $set: {
            typeCode: `${categoryCodes[category.slug]}-${String(productIndex + 1).padStart(2, '0')}`,
            name, slug, category: categoryDoc._id,
            description: task,
            shortDescription: task,
            brand,
            names: [{ lang: 'en', value: name }, { lang: 'hi', value: hindi }, { lang: 'ta', value: tamil }],
            aliases: [name, hindi, tamil],
            searchTerms: [brand, name, hindi, tamil],
            taskTerms: [task, hindi, tamil],
            defaultDailyRate: dailyRate,
            replacementValue,
            depositAmount,
            currency: 'INR',
            imageUrls: [category.image],
            active: true
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      for (let unit = 0; unit < 2; unit += 1) {
        const city = cities[(productIndex * 2 + unit + categories.indexOf(category)) % cities.length];
        const assetId = `RH-${categoryCodes[category.slug]}-${String(productIndex + 1).padStart(2, '0')}-${unit + 1}`;
        const legacy = await Equipment.findOneAndUpdate(
          { assetId },
          {
            $set: {
              owner: users.owner._id,
              category: categoryDoc._id,
              name,
              description: task,
              brand,
              dailyRate,
              replacementValue,
              depositAmount,
              currency: 'INR',
              location: { city: city.city, region: city.state },
              images: [category.image],
              condition: unit === 0 ? 'excellent' : 'good',
              status: 'available',
              active: true,
              swapTypes: ['item_for_item', 'item_plus_cash', 'cash_for_item']
            },
            $setOnInsert: { assetId }
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        await syncAssetForLegacy(legacy);
        await EquipmentAsset.updateOne(
          { legacyEquipment: legacy._id },
          {
            $set: {
              equipmentType: type._id,
              assetId,
              serialNumber: `${assetId}-SN`,
              qrCode: `rentalhub://${assetId}`,
              currency: 'INR',
              condition: unit === 0 ? 'excellent' : 'good',
              location: {
                type: 'Point',
                coordinates: city.coordinates,
                city: city.city,
                district: city.district,
                state: city.state,
                pincode: city.pincode,
                country: 'India',
                formatted: `${city.city}, ${city.state} ${city.pincode}`
              },
              searchText: [name, brand, task, hindi, tamil].join(' ')
            }
          }
        );
        seededAssets.set(assetId, { legacy, category, name, task, dailyRate });
      }
    }
  }

  await Equipment.updateMany(
    { owner: users.owner._id, name: { $in: legacyDemoNames } },
    { $set: { active: false, status: 'unavailable' } }
  );
  await EquipmentAsset.updateMany(
    { owner: users.owner._id, legacyEquipment: { $in: await Equipment.find({ owner: users.owner._id, name: { $in: legacyDemoNames } }).distinct('_id') } },
    { $set: { active: false, status: 'offline', lifecycleState: 'retired' } }
  );
  await EquipmentAsset.updateMany(
    { owner: users.owner._id, assetId: /^RH-CAM-/ },
    { $set: { active: false, status: 'offline', lifecycleState: 'retired' } }
  );
  await Equipment.updateMany(
    { owner: users.owner._id, assetId: /^RH-CAM-/ },
    { $set: { active: false, status: 'unavailable' } }
  );
  const staleSeedIds = /^RH-(CAM|POW|EVE|SPO|HOM|CON)-/;
  await EquipmentAsset.updateMany(
    { owner: users.owner._id, assetId: staleSeedIds },
    { $set: { active: false, status: 'offline', lifecycleState: 'retired' } }
  );
  await Equipment.updateMany(
    { owner: users.owner._id, assetId: staleSeedIds },
    { $set: { active: false, status: 'unavailable' } }
  );

  await migrateLegacyInventory();
  await EquipmentType.updateMany(
    { active: true, _id: { $nin: await EquipmentAsset.distinct('equipmentType', { active: true, status: { $nin: ['offline', 'retired'] } }) } },
    { $set: { active: false } }
  );
  await Package.updateMany(
    { owner: users.owner._id, name: { $in: legacyDemoPackageNames } },
    { $set: { active: false } }
  );

  const assetFor = (categoryName, productIndex) => {
    const category = categories.find((entry) => entry.name === categoryName);
    const product = category.products[productIndex];
    return seededAssets.get(`RH-${categoryCodes[category.slug]}-${String(productIndex + 1).padStart(2, '0')}-1`).legacy._id;
  };
  const packages = [
    ['Repair a Home', 'A practical kit for drilling, cutting, and quick home repairs.', [['Power Tools', 0], ['Power Tools', 1], ['Home & Garden', 2]], 1250],
    ['Create a Video', 'Camera, lens, and audio tools for a polished shoot.', [['Cameras & Lenses', 0], ['Cameras & Lenses', 3], ['Audio & Music', 0]], 2300],
    ['Host an Event', 'Projection, sound, and lighting for a memorable gathering.', [['Event Equipment', 0], ['Audio & Music', 2], ['Event Equipment', 1]], 3200],
    ['Go Camping', 'Tent, sleeping kit, and cooking gear for an outdoor weekend.', [['Camping & Outdoors', 0], ['Camping & Outdoors', 2], ['Camping & Outdoors', 3]], 1050],
    ['Maintain a Garden', 'Power tools for keeping a home garden in great shape.', [['Home & Garden', 0], ['Home & Garden', 1], ['Home & Garden', 3]], 1550]
  ];
  for (const [name, description, selections, dailyRate] of packages) {
    const equipmentIds = selections.map(([category, index]) => assetFor(category, index));
    await Package.findOneAndUpdate(
      { owner: users.owner._id, name },
      { $set: { description, equipment: equipmentIds, dailyRate, currency: 'INR', active: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  console.log(`Seed complete: ${accounts.length} accounts, ${categories.length} categories, ${seededAssets.size} physical assets, ${packages.length} task-first packages.`);
  console.log('Demo logins: customer@rentalhub.com / Customer@123; owner@rentalhub.com / Owner@123; admin@rentalhub.com / Admin@123');
}

seed()
  .catch((error) => {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
