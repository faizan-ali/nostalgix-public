import type { Images } from '@/db/schema'

const MAX_EVENT_INTERVAL_MS = 0.5 * 60 * 60 * 1000 // 1/2 hour

const detectEvents = (photos: Images[]): Images[][] => {
  const sortedPhotos = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())

  const events: Images[][] = []
  let currentEvent: Images[] = []

  for (const photo of sortedPhotos) {
    if (currentEvent.length === 0) {
      currentEvent.push(photo)
      continue
    }

    const lastPhoto = currentEvent[currentEvent.length - 1]
    const timeDiff = photo.takenAt.getTime() - lastPhoto.takenAt.getTime()

    // Using location and time interval to detect events
    if (timeDiff <= MAX_EVENT_INTERVAL_MS && currentEvent[0].neighborhood === photo.neighborhood) {
      currentEvent.push(photo)
    } else {
      events.push(currentEvent)
      currentEvent = [photo]
    }
  }

  if (currentEvent.length > 0) {
    events.push(currentEvent)
  }

  return events
}

export const markEventRepresentatives = (events: Images[]): void => {
  const detectedEvents = detectEvents(events)

  const better: Images[] = []
  const lesser: Images[] = []

  for (const event of detectedEvents) {
    const maxPerEvent = event.length > 2 ? Math.floor(event.length / 2) || 1 : event.length

    if (event.length <= maxPerEvent || event.length === 1) {
      continue
    }

    console.log(`Event: ${event[0]?.dropboxFileName} has ${event.length} photos, marking ${maxPerEvent} as lesser`)

    const scoredPhotos = [...event.filter(e => e.totalScore)]

    scoredPhotos.sort((a, b) => b.totalScore! - a.totalScore!)
    better.push(...scoredPhotos.slice(0, maxPerEvent))
    lesser.push(...scoredPhotos.slice(maxPerEvent))
  }

  lesser.forEach(image => {
    // If it's a really good picture just keep it
    if (image.totalScore! < 7.9) {
      image.isLesserInEvent = true
      image.betterEventUrls = better.map(b => b.url).join(',')
    }
  })
}
