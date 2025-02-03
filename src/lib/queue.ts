import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'

/**
 * Represents the current state and metadata of a task in the queue
 */
interface TaskMetadata {
  name: string
  startTime?: number
  endTime?: number
  error?: Error
  status: 'pending' | 'running' | 'completed' | 'failed'
}

interface QueueProps {
  concurrency?: number
  delayFloor?: number
  delayCeiling?: number
  throwOnRepeatTaskname?: boolean
}

/**
 * BatchQueueClient processes async tasks in batches of 2 with configurable delays.
 * Features:
 * - Processes tasks in pairs (batches of 2)
 * - Adds random delays (200-600ms) between tasks in a batch
 * - Adds random delays between batches
 * - Provides comprehensive task tracking and metrics
 * - Emits events for monitoring queue activity
 */
export class Queue extends EventEmitter {
  private queue: PQueue
  private currentBatchCount = 0 // Tracks position within current batch
  private batchInProgress = false
  private currentBatchId = 0
  private taskMap: Map<string, TaskMetadata> = new Map()
  private batchStartTime?: number
  private delayFloor: number
  private delayCeiling: number
  private throwOnRepeatTaskname = false

  constructor({concurrency = 2, delayCeiling = 200, delayFloor = 600, throwOnRepeatTaskname}: QueueProps = {}) {
    super()

    this.queue = new PQueue({concurrency})
    this.delayFloor = delayFloor
    this.delayCeiling = delayCeiling
    this.throwOnRepeatTaskname = Boolean(throwOnRepeatTaskname)

    this.setupQueueListeners()
  }

  /**
   * Sets up event listeners for queue state changes
   * Handles batch tracking and emits events for monitoring
   */
  private setupQueueListeners(): void {
    // When queue becomes empty
    this.queue.on('idle', () => {
      this.currentBatchCount = 0
      this.batchInProgress = false
      console.log('queueEmpty')
    })

    // When a new task starts processing
    this.queue.on('active', () => {
      this.currentBatchCount++

      // Start of new batch (odd-numbered tasks)
      if (this.currentBatchCount % 2 === 1 && !this.batchInProgress) {
        this.batchInProgress = true
        this.currentBatchId++
        this.batchStartTime = Date.now()

        // Identify tasks in this batch for monitoring
        const pendingTaskNames = Array.from(this.taskMap.entries())
            .filter(([_, meta]) => meta.status === 'pending')
            .map(([name]) => name)
            .slice(0, 2)

        console.log('batchStart', this.currentBatchId, pendingTaskNames)
      }
    })
  }

  /**
   * Generates a random delay between 200-600ms
   */
  private getRandomDelay(): number {
    return Math.floor(Math.random() * (this.delayCeiling - this.delayFloor + 1))
  }

  /**
   * Adds a new task to the queue
   * @param name Unique identifier for the task
   * @param task Async function to be executed
   * @throws Error if task name already exists
   */
  async add(name: string, task: () => Promise<any>): Promise<void> {
    if (this.taskMap.has(name)) {
      console.warn(`Task with name "${name}" already exists`)
      if (this.throwOnRepeatTaskname) {
        throw new Error(`Task with name "${name}" already exists`)
      }
    }

    // Initialize task metadata
    this.taskMap.set(name, {
      name,
      status: 'pending'
    })

    // Wrap the task with monitoring and delay logic
    const wrappedTask = async () => {
      try {
        // Update task status and emit start event
        const metadata = this.taskMap.get(name)!
        metadata.status = 'running'
        metadata.startTime = Date.now()
        console.log('taskStart', name)

        await task()

        // Update task status and emit completion event
        metadata.status = 'completed'
        metadata.endTime = Date.now()
        console.log('taskComplete', name, metadata.endTime - metadata.startTime)

        // Handle delays based on position in batch
        if (this.currentBatchCount % 2 === 0) {
          // End of batch - pause queue and add delay before next batch
          this.queue.pause()
          const batchDuration = Date.now() - (this.batchStartTime || 0)
          console.log('\nbatchComplete', this.currentBatchId, batchDuration)
          await new Promise(resolve => setTimeout(resolve, this.getRandomDelay()))
          this.queue.start()
        } else {
          // Middle of batch - add delay before next task
          await new Promise(resolve => setTimeout(resolve, this.getRandomDelay()))
        }
      } catch (error) {
        // Handle task failure
        const metadata = this.taskMap.get(name)!
        metadata.status = 'failed'
        metadata.error = error as Error
        metadata.endTime = Date.now()
        console.error('taskError', name, error as Error)
        throw error
      }
    }

    const result = this.queue.add(wrappedTask)

    // Start queue if it's not already running
    if (!this.queue.isPaused) {
      this.queue.start()
    }

    return result
  }

  /**
   * Returns a promise that resolves when all tasks are complete
   */
  async onComplete(): Promise<void> {
    return this.queue.onIdle()
  }
}