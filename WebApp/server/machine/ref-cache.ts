import type { Db } from 'mongodb'
import { COLLECTIONS } from '../db.ts'
import type { RefData } from '../types.ts'

/** Reference tables change about never, so keep them in memory and reload on edit. */
export class RefCache {
  private readonly db: Db
  private data: RefData = { varieties: [], diseases: [], ripeness: [], sizes: [] }

  constructor(db: Db) {
    this.db = db
  }

  async load(): Promise<void> {
    const rows = async <T>(collection: string, sortKey: string) =>
      (await this.db.collection(collection).find({}, { projection: { _id: 0 } }).sort({ [sortKey]: 1 }).toArray()) as T[]
    this.data = {
      varieties: await rows(COLLECTIONS.varieties, 'variety_id'),
      diseases: await rows(COLLECTIONS.diseases, 'disease_id'),
      ripeness: await rows(COLLECTIONS.ripeness, 'sort_order'),
      sizes: await rows(COLLECTIONS.sizes, 'sort_order'),
    }
  }

  get(): RefData {
    return this.data
  }
}
