import { boolean, customType, decimal, index, integer, pgTable, timestamp, varchar, vector } from 'drizzle-orm/pg-core'

const decimalNumber = customType<{ data: number }>({
  dataType() {
    return 'numeric'
  },
  fromDriver(value) {
    return Number(value)
  }
})

export const Images = pgTable(
  'images',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    url: varchar(),
    dropboxId: varchar().unique().notNull(),
    dropboxPath: varchar().notNull(),
    dropboxFileName: varchar().notNull(),
    mimeType: varchar().notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date()),
    latitude: decimalNumber(),
    longitude: decimalNumber(),
    altitude: varchar(),
    size: integer(),
    deviceMake: varchar(),
    city: varchar(),
    state: varchar(),
    neighborhood: varchar(),
    deviceModel: varchar(),
    takenAt: timestamp().notNull(),
    technicalScore: decimalNumber(),
    technicalReason: varchar(),
    contentScore: decimalNumber(),
    contentReason: varchar(),
    emotionalScore: decimalNumber(),
    emotionalReason: varchar(),
    totalScore: decimalNumber(),
    rejectionReason: varchar(),
    isHighlightable: boolean(),
    // This photo is a lesser quality version of another similar photo from the same event
    isLesserDuplicate: boolean().default(false),
    // Will point to the url of the better quality duplicate
    betterDuplicateUrl: varchar(),
    // In a 30 minute interval, this picture scored lower than tohers
    isLesserInEvent: boolean().default(false),
    // Will point to the urls comma separated of better pictures in this event
    betterEventUrls: varchar(),
    embedding: vector({ dimensions: 1024 }),
    isProcessed: boolean().default(false),
    // https://orm.drizzle.team/docs/guides/vector-similarity-search
    // https://neon.tech/docs/extensions/pgvector
    isSelfie: boolean().default(false)
  },
  table => ({
    embeddingsIndex: index('embeddingsIndex').using('hnsw', table.embedding.op('vector_cosine_ops'))
  })
)

export type Images = typeof Images.$inferSelect