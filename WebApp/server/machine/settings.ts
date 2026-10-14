import type { Db } from 'mongodb'
import { COLLECTIONS } from '../db.ts'

interface MachineSettings {
  _id: string
  declared_variety?: string | null
}

const KEY = 'machine'

/** The variety the operator pre-sorted the current batch as. Model 1 checks it. */
export async function getDeclaredVariety(db: Db): Promise<string | null> {
  const doc = await db.collection<MachineSettings>(COLLECTIONS.settings).findOne({ _id: KEY })
  return doc?.declared_variety ?? null
}

export async function setDeclaredVariety(db: Db, name: string | null): Promise<void> {
  await db
    .collection<MachineSettings>(COLLECTIONS.settings)
    .updateOne({ _id: KEY }, { $set: { declared_variety: name } }, { upsert: true })
}
