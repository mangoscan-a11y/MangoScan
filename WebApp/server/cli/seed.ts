/**
 * Prepare the local MongoDB.
 *
 *   npm run db:seed                         create indexes and reference data
 *   npm run db:seed -- --sample             also add 30 demo scans
 *   npm run db:seed -- --sample=100         ... or any number
 *   npm run db:seed -- --clear-scans --yes  delete ALL scans and captured images
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from '../config.ts'
import { COLLECTIONS, connectDb, ensureIndexes, seedReference, syncScanCounter } from '../db.ts'
import { seedSampleScans } from '../dev/sample-data.ts'
import { RefCache } from '../machine/ref-cache.ts'

try {
  process.loadEnvFile('.env')
} catch {
  // no .env, defaults apply
}

const args = process.argv.slice(2)
const config = loadConfig(process.env, process.cwd())
const sampleArg = args.find((a) => a === '--sample' || a.startsWith('--sample='))
const sampleCount = sampleArg ? (sampleArg.includes('=') ? Number(sampleArg.split('=')[1]) : 30) : 0
const clear = args.includes('--clear-scans')

if (!Number.isInteger(sampleCount) || sampleCount < 0 || sampleCount > 100000) {
  console.error('--sample must be a whole number between 0 and 100000')
  process.exit(1)
}

const { client, db } = await connectDb(config.mongoUri, config.mongoDb)
try {
  if (clear) {
    const existing = await db.collection(COLLECTIONS.scans).countDocuments()
    if (!args.includes('--yes')) {
      console.error('This would delete ' + existing + ' scans and every captured image. Run again with --yes to confirm.')
      process.exitCode = 1
    } else {
      await db.collection(COLLECTIONS.scans).deleteMany({})
      await db.collection<{ _id: string }>(COLLECTIONS.counters).deleteOne({ _id: 'scan_id' })
      await fs.rm(path.join(config.storageDir, 'scan-images'), { recursive: true, force: true })
      console.log('Deleted ' + existing + ' scans and the captured images.')
    }
  }

  if (process.exitCode !== 1) {
    await ensureIndexes(db)
    await seedReference(db)
    await syncScanCounter(db)
    console.log('Database "' + config.mongoDb + '" is ready at ' + config.mongoUri)

    if (sampleCount > 0) {
      const refs = new RefCache(db)
      await refs.load()
      const added = await seedSampleScans(db, refs.get(), sampleCount)
      console.log('Added ' + added + ' demo scans.')
    }
  }
} finally {
  await client.close()
}
