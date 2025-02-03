# Nostalgix

### Your local photo "Highlights" tool. 

Google Photos and iOS are really good at looking at all your photos and highlighting the best ones. But there are lots of limitations, especially around how far back you can go. 
Nostalgix looks at all your photos and highlights the best ones based on technical, content, and emotional analysis. It screens out poor quality images, screenshots, slides etc.

## 🌟 Features

### Core Processing
- **Automated Photo Processing**
  - Processes photos from Dropbox Camera Uploads folder
  - Extracts EXIF metadata (location, device info, timestamps)
  - Screens out screenshots and low-quality images
  - Handles batch processing with configurable concurrency
  - Automatic screenshot detection using EXIF analysis

### AI Analysis
- **Quality Assessment**
  - Technical quality scoring
  - Content analysis
  - Emotional impact evaluation
  - Custom scoring weights for selfies vs. regular photos
  - Vision AI-powered image understanding

### Smart Organization
- **Duplicate Detection**
  - Cosine similarity comparison of image embeddings
  - Time-based grouping (10-minute windows)
  - Adjustable similarity thresholds (0.885 default)
  - Special handling for near-simultaneous photos (12-second window)

- **Event Grouping**
  - Time-based event detection (30-minute windows)
  - Location-based grouping using neighborhood data
  - Automatic representative photo selection
  - Smart event photo reduction (keeps top 50% of photos)

- **Location Services**
  - Reverse geocoding with rich location data
  - Neighborhood, city, state detection
  - Rate-limited API handling
  - Coordinate validation and error handling

### Storage & Processing
- **Multi-Cloud Integration**
  - Dropbox for source photos and highlights
  - AWS S3 for processed image storage
  - Jina AI for image embeddings (1024-dimensional vectors)
  - PostgreSQL with pgvector for similarity search

- **Image Processing**
  - Location and date overlay generation
  - EXIF data preservation
  - Smart orientation handling
  - Custom font rendering with drop shadows

## 🚀 Getting Started

### Prerequisites

- Node.js 16+
- PostgreSQL with pgvector extension
- API Keys for:
  - Dropbox
  - Google Maps (for geocoding)
  - OpenAI (GPT-4 Vision)
  - AWS S3
  - Jina AI (for embeddings)

### Database

The system uses PostgreSQL

### Quality Scoring System

Images are scored based on three main criteria:
1. Technical Quality (35% weight, 15% for selfies)
2. Content Interest (30% weight)
3. Emotional Impact (35% weight, 55% for selfies)

Minimum highlight score: 6.91

## 📖 Usage

### Basic Processing

typescript
// Process a date range
await main('2024-01-01', '2024-01-31')



### Processing Flow

1. **Image Discovery & Download**
   - Scans Dropbox Camera Uploads folder
   - Downloads in batches with rate limiting
   - Extracts EXIF metadata

2. **Initial Screening**
   - Screenshot detection
   - Technical quality assessment
   - Content appropriateness check

3. **Deep Analysis**
   - Technical quality scoring
   - Content interest evaluation
   - Emotional impact assessment
   - Embedding generation

4. **Organization**
   - Duplicate detection using embeddings
   - Event grouping by time and location
   - Representative photo selection

5. **Export**
   - High-quality photo selection (score >= 6.91)
   - Location/date overlay generation
   - Upload to Dropbox Highlights folder

## 🔧 Configuration

### Duplicate Detection
- `SIMILARITY_THRESHOLD`: 0.885
- `CLOSE_TIME_THRESHOLD`: 0.85
- `TIME_WINDOW_MS`: 10 minutes
- `CLOSE_TIME_WINDOW_MS`: 12 seconds

### Event Detection
- `MAX_EVENT_INTERVAL_MS`: 30 minutes
- Event size reduction: 50% of photos kept

### Rate Limits
- Google Geocoding: 50 queries per second
- Dropbox API: Automatic retry with exponential backoff
- Image Processing: Configurable batch sizes and delays

## 📝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.