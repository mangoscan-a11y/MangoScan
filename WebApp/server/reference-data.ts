import type { Disease, MangoVariety, RipenessLevel, SizeGrade } from '../src/lib/database.types.ts'

// Label vocabulary is pinned to MyTasks/model5_fusion/fusion/vocab.py.
// Gram ranges are display copies of MyTasks/model5_fusion/config/routing.toml,
// which stays the authority for routing.

export const VARIETIES: MangoVariety[] = [
  { variety_id: 1, variety_name: 'Carabao', description: 'The premium Philippine mango. Sweet, rich, fiber-free flesh, golden-yellow when ripe.', market_price: 120 },
  { variety_id: 2, variety_name: 'Apple Mango', description: 'Round, apple-sized mango with a firm texture and mild sweetness.', market_price: 90 },
  { variety_id: 3, variety_name: 'Indian', description: 'Smaller, fiber-rich variety with a tartly sweet flavor. Common in local markets.', market_price: 75 },
  { variety_id: 4, variety_name: 'Chupadera', description: 'Small, sweet sucking mango variety.', market_price: 60 },
  { variety_id: 5, variety_name: 'Wani', description: 'Local variety with a distinct aromatic flavor and moderate fiber content.', market_price: 70 },
  { variety_id: 6, variety_name: 'Kabayo', description: 'Larger, elongated variety with firm flesh, mildly sweet.', market_price: 65 },
]

export const DISEASES: Disease[] = [
  { disease_id: 1, disease_name: 'Healthy', description: 'No disease detected. No visible lesions, discoloration, or surface defects.', severity_level: 'none' },
  { disease_id: 2, disease_name: 'Anthracnose', description: 'Fungal disease causing dark, sunken lesions on the skin. Spreads during post-harvest storage.', severity_level: 'high' },
  { disease_id: 3, disease_name: 'Mango Scab', description: 'Fungal disease causing corky, scab-like raised spots on the skin surface.', severity_level: 'moderate' },
]

// The machine has no overripe bin, so Color is binary.
export const RIPENESS_LEVELS: RipenessLevel[] = [
  { ripeness_id: 1, ripeness_name: 'Green', description: 'Unripe. Skin is green and the flesh is firm.', sort_order: 1 },
  { ripeness_id: 2, ripeness_name: 'Yellow', description: 'Ripening or ripe. Yellow skin, ready for market.', sort_order: 2 },
]

export const SIZE_GRADES: SizeGrade[] = [
  { size_id: 1, size_name: 'Small', description: 'Small-grade fruit.', min_grams: 0, max_grams: 200, sort_order: 1 },
  { size_id: 2, size_name: 'Medium', description: 'Standard mid-market size grade.', min_grams: 200, max_grams: 350, sort_order: 2 },
  { size_id: 3, size_name: 'Large', description: 'Large-grade fruit, premium size.', min_grams: 350, max_grams: null, sort_order: 3 },
]
