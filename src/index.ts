import {findAndMarkDuplicates} from '@/classifiers/duplicate'
import {markEventRepresentatives} from '@/classifiers/event'
import {ImageScreener} from '@/classifiers/screen'
import {DropboxClient} from '@/clients/dropbox'
import {GeocodingService} from '@/clients/google-geocode'
import {createEmbedding} from '@/clients/jina'
import {uploadImageToS3} from '@/clients/s3'
import {db} from '@/db'
import {Images} from '@/db/schema'
import {env} from '@/lib/env'
import {extractMetadata} from '@/lib/image'
import {Queue} from '@/lib/queue'
import {Highlighter} from '@/services/highlighter'
import {addOverlay} from '@/services/image'
import {LLMService} from '@/services/llm'
import {format} from 'date-fns'
import {and, eq} from 'drizzle-orm'

const llm = new LLMService()
const geocode = new GeocodingService(env.GOOGLE_MAPS_API_KEY)
const dropbox = new DropboxClient()
const hightlighter = new Highlighter(llm, db)
const screener = new ImageScreener(llm)
let uploadCounter = 0
let totalCounter = 0

const existing = (await db.select({name: Images.dropboxFileName}).from(Images).where(eq(Images.isProcessed, true))).map(_ => _.name)

console.log(`Found ${existing.length} existing images`)

// Download for 3 dates at a time
const dateQueue = new Queue({concurrency: 3, delayFloor: 0, delayCeiling: 1000})
const imageQueue = new Queue({concurrency: 10, delayFloor: 300, delayCeiling: 500})

const main = async (start: string, end: string) => {
    const dates = returnISODatesInRange(start, end)

    await Promise.all(
        dates.map(date =>
            dateQueue.add(`Processing date: ${date}`, async () => {
                const images = await dropbox.downloadImages('/Camera Uploads', existing, {date: new Date(date),})
                console.log(`Fetched ${images.length} images to process`)
                totalCounter += images.length

                const imageEntities: Images[] = []

                await Promise.all(
                    images.map(async image =>
                        imageQueue.add(`Processing image: ${image.dropboxMeta.name}`, async () => {
                            try {
                                const exists = (
                                    await db
                                        .select()
                                        .from(Images)
                                        .where(and(eq(Images.dropboxId, image.dropboxMeta.id), eq(Images.isProcessed, true)))
                                )[0]

                                if (exists) {
                                    return console.log(`Image already processed: ${image.dropboxMeta.name}`)
                                }

                                const metadata = extractMetadata(image.buffer, image.dropboxMeta.path_lower!, image.dropboxMeta.content_hash!)

                                if (metadata.isScreenshot) {
                                    console.log('Encountered screenshot, continuing')
                                    await db
                                        .insert(Images)
                                        .values({
                                            dropboxId: String(image.dropboxMeta.id),
                                            dropboxPath: image.dropboxMeta.path_lower!,
                                            size: image.dropboxMeta.size,
                                            takenAt: metadata.timestamp || new Date(image.dropboxMeta.server_modified),
                                            mimeType: metadata.mimeType,
                                            dropboxFileName: image.dropboxMeta.name,
                                            rejectionReason: 'screenshot',
                                            isProcessed: true
                                        })
                                        .onConflictDoNothing()
                                    return
                                }

                                const payload = {
                                    dropboxPath: image.dropboxMeta.path_lower!,
                                    latitude: metadata.location?.latitude! as any,
                                    longitude: metadata.location?.longitude as any,
                                    altitude: metadata.location?.altitude,
                                    deviceMake: metadata.deviceInfo?.make,
                                    deviceModel: metadata.deviceInfo?.model,
                                    size: image.dropboxMeta.size,
                                    takenAt: metadata.timestamp || new Date(image.dropboxMeta.server_modified),
                                    mimeType: metadata.mimeType,
                                    dropboxFileName: image.dropboxMeta.name
                                } satisfies Partial<typeof Images.$inferInsert>

                                console.log(`Inserting image ${image.dropboxMeta.name}`, {payload})

                                let persisted = (
                                    await db
                                        .insert(Images)
                                        .values({
                                            dropboxId: String(image.dropboxMeta.id),
                                            ...payload
                                        })
                                        .onConflictDoUpdate({
                                            target: Images.dropboxId,
                                            set: payload
                                        })
                                        .returning()
                                )[0]

                                if (!persisted.rejectionReason) {
                                    persisted.rejectionReason = (await screener.screenImage(persisted, image.buffer, image.fileType))?.rejectionReason || null

                                    await db.update(Images).set({rejectionReason: persisted.rejectionReason}).where(eq(Images.id, persisted.id))

                                    if (persisted.rejectionReason !== 'none') {
                                        await db.update(Images).set({isProcessed: true}).where(eq(Images.id, persisted.id))
                                        return console.log(`Image rejected: ${persisted.dropboxFileName}`)
                                    }
                                } else if (persisted.rejectionReason !== 'none') {
                                    return console.log(`Trying to process rejected image: ${persisted.dropboxFileName}`)
                                }

                                // Double check to ensure rejected images aren't somehow uploaded
                                if (!persisted.url && persisted.rejectionReason === 'none') {
                                    const s3Prefix = `images/${persisted.dropboxFileName.replaceAll(' ', '_')}`

                                    console.log(`Uploading original to S3: ${persisted.dropboxFileName}`)

                                    const url = await uploadImageToS3(image.buffer, `${s3Prefix}/original.${image.fileType.replaceAll('.', '')}`, metadata.mimeType)

                                    await db.update(Images).set({url}).where(eq(Images.id, persisted.id))

                                    persisted.url = url
                                }

                                if (!persisted.totalScore) {
                                    console.log(`Analyzing highlights: ${persisted.dropboxFileName}`)
                                    const {totalScore} = await hightlighter.highlightImageAndPersist(persisted, image.buffer, image.fileType)
                                    persisted = (await db.update(Images).set({totalScore}).where(eq(Images.id, persisted.id)).returning())[0]
                                }

                                if (!persisted.city && payload.latitude && payload.longitude) {
                                    console.log(`Geocoding: ${image.dropboxMeta.name}`)
                                    const location = await geocode.reverseGeocode(payload.latitude, payload.longitude)

                                    console.log(`Updating location: ${image.dropboxMeta.name}`, {location})
                                    persisted = (
                                        await db
                                            .update(Images)
                                            .set({
                                                neighborhood: location.neighborhood,
                                                city: location.city,
                                                state: location.state || location.sublocality,
                                                latitude: payload.latitude,
                                                longitude: payload.longitude
                                            })
                                            .where(eq(Images.id, persisted.id))
                                            .returning()
                                    )[0]
                                }

                                if (!persisted.embedding) {
                                    console.log(`Extracting image embedding: ${image.dropboxMeta.name}`)
                                    const embedding = await createEmbedding(image.base64)

                                    await db
                                        .update(Images)
                                        .set({embedding})
                                        .where(eq(Images.dropboxId, String(image.dropboxMeta.id)))

                                    persisted.embedding = embedding
                                }

                                imageEntities.push(persisted)
                            } catch (e) {
                                console.error(`Error processing image: ${image.dropboxMeta.name}`, {e})
                            }
                        })
                    )
                )

                await imageQueue.onComplete()

                findAndMarkDuplicates(imageEntities)
                markEventRepresentatives(imageEntities.filter(e => !e.isLesserDuplicate))

                await Promise.all(
                    imageEntities.map(async e => {
                        await db
                            .update(Images)
                            .set({
                                isLesserDuplicate: Boolean(e.isLesserDuplicate),
                                isLesserInEvent: Boolean(e.isLesserInEvent),
                                betterDuplicateUrl: e.betterDuplicateUrl,
                                betterEventUrls: e.betterEventUrls
                            })
                            .where(eq(Images.id, e.id))

                        if (!e.isLesserDuplicate && !e.isProcessed && e.totalScore! >= 6.91 && e.rejectionReason === 'none' && !e.isLesserInEvent) {
                            const city = e.city || e.neighborhood
                            const location = `${city || ''}${e.state ? `${city ? ', ' : ''}${e.state}` : ''}`
                            console.log(`Adding overlay for ${e.dropboxFileName} and uploaded to Dropbox with location: ${location}`)
                            const date = format(e.takenAt, 'MMM yyyy')
                            const overlayBuffer = await addOverlay(images.find(image => image.dropboxMeta.id === e.dropboxId)!.buffer, location, date)
                            await dropbox.uploadFile(overlayBuffer, `/Highlights/${e.dropboxFileName}`)
                            uploadCounter++
                        }

                        await db.update(Images).set({isProcessed: true}).where(eq(Images.id, e.id))
                    })
                )
            })
        )
    )

    await dateQueue.onComplete()
    console.log(`Finished. Uploaded ${uploadCounter} images out of ${totalCounter}`)
}

export const returnISODatesInRange = (start: string, end: string): string[] => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const dates = []

    while (startDate <= endDate) {
        dates.push(startDate.toISOString().split('T')[0])
        startDate.setDate(startDate.getDate() + 1)
    }

    return dates
}

// Completed: 2024-01-10 to 2024-01-31
// 2025-01-01 to 2025-01-29
// 2022-02-01 to 2025-02-20
// 2021-02-01 to 2021-02-30
// 2020-02-01 to 2020-02-30
// 2019-02-01 to 2019-02-30
// 2023-11-15 (partially) this was an upload to Dropbox after almost a year of no uploads
// await Promise.all(returnISODatesInRange('2023-11-10', '2023-11-16').map(main))
await main('2018-09-01', '2018-09-30')
