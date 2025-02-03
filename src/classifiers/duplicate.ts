import type { Images } from '@/db/schema'
import cosineSimilarity from 'compute-cosine-similarity'

const SIMILARITY_THRESHOLD = 0.885
const CLOSE_TIME_THRESHOLD = 0.85 // Lower threshold for very close timestamps
const TIME_WINDOW_MS = 10 * 60 * 1000 // 10 minutes in milliseconds
const CLOSE_TIME_WINDOW_MS = 12 * 1000 // 12 seconds in milliseconds

// TODO: Pretty inefficient, could be optimized to combine all the logic within the loop rather than the additional loop at the end
export const findAndMarkDuplicates = (photos: Images[]): void => {
  const processed = new Set<number>()

  // Sort photos by timestamp
  const sortedPhotos = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())

  for (let i = 0; i < sortedPhotos.length; i++) {
    const photo1 = sortedPhotos[i]
    if (processed.has(photo1.id)) continue

    const currentGroup: Images[] = [photo1]
    const windowEnd = photo1.takenAt.getTime() + TIME_WINDOW_MS

    // Look at all remaining unprocessed photos within the time window
    for (let j = i + 1; j < sortedPhotos.length; j++) {
      const photo2 = sortedPhotos[j]
      if (processed.has(photo2.id)) continue

      // Stop checking if we're beyond the time window
      if (photo2.takenAt.getTime() > windowEnd) break

      // Check if photo2 is similar to ANY photo in the current group
      let isPartOfGroup = false
      for (const groupPhoto of currentGroup) {
        const similarity = cosineSimilarity(groupPhoto.embedding!, photo2.embedding!)
        const timeDiff = Math.abs(groupPhoto.takenAt.getTime() - photo2.takenAt.getTime())
        const threshold = timeDiff <= CLOSE_TIME_WINDOW_MS ? CLOSE_TIME_THRESHOLD : SIMILARITY_THRESHOLD

        if (!similarity) {
          throw new Error('null similarity value')
        }

        if (similarity >= threshold) {
          console.log(`Found duplicate for ${groupPhoto.dropboxFileName} in ${photo2.dropboxFileName} at similarity: ${similarity} (threshold: ${threshold})`)
          isPartOfGroup = true
          break
        } else {
          console.log(`No duplicate for ${groupPhoto.dropboxFileName} in ${photo2.dropboxFileName} at similarity: ${similarity} (threshold: ${threshold})`)
        }
      }

      if (isPartOfGroup) {
        currentGroup.push(photo2)
        processed.add(photo2.id)
      }
    }

    processed.add(photo1.id)

    // Mark duplicates if we found any
    if (currentGroup.length > 1) {
      const sortedGroup = currentGroup.sort((a, b) => {
        if (a.totalScore === b.totalScore) {
          return b.takenAt.getTime() - a.takenAt.getTime() // Reversed order to prefer newer photos
        }
        return b.totalScore! - a.totalScore!
      })

      for (let k = 1; k < sortedGroup.length; k++) {
        sortedGroup[k].isLesserDuplicate = true
        // The first photo in sorted group is the best one
        sortedGroup[k].betterDuplicateUrl = sortedGroup[0].url
      }
    }
  }
}
