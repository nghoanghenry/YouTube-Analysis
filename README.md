# YouTube Analysis Service

Phân tích video YouTube: lấy metadata, chụp screenshot, tải audio, tạo transcript AI.

## Tính năng

- Phân tích metadata video (tiêu đề, kênh, lượt xem...)
- Chụp screenshot bằng Puppeteer
- Tải và xử lý audio (WAV, 16kHz, mono)
- Tạo transcript và phân tích AI/human
- REST API nhận URL YouTube
- Thư viện transcript, phát hiện AI/human

## Hướng dẫn nhanh

### 1. Clone repo

```sh
git clone https://github.com/nghoanghenry/YouTube-Analysis.git
cd YouTube-Analysis
```

### 2. Tạo file .env

Tạo file `.env` ở thư mục gốc với nội dung mẫu:

```
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ZEROGPT_API_KEY=your_zerogpt_api_key
NODE_ENV=production
PORT=8080
```

> Xem thêm `.env.example` nếu có.

### 3. Chạy bằng Docker Compose (khuyến nghị)

```sh
docker-compose up --build
```

Hoặc dùng Docker:

```sh
docker build -t youtube-analysis .
docker run -d -p 8080:8080 --env-file .env youtube-analysis
```

### 4. Truy cập ứng dụng

- Máy local: http://localhost:8080
- Hoặc dùng SSH port-forward để bảo mật key ssh ở file ssh_key.txt

## Biến môi trường

| Key                | Ý nghĩa                           |
| ------------------ | --------------------------------- |
| ELEVENLABS_API_KEY | API key cho ElevenLabs transcript |
| ZEROGPT_API_KEY    | API key cho ZeroGPT AI detection  |
| NODE_ENV           | `production` hoặc `development`   |
| PORT               | Cổng server (mặc định: 8080)      |

## Thiết kế & Lý do

- **Docker hóa:** Dễ deploy, build nhất quán.
- **Puppeteer + Chromium:** Headless browser để scrape YouTube và chụp hình.
- **Audio:** ffmpeg + ytdlp-nodejs để tải và convert audio chuẩn.
- **Transcript AI:** Tích hợp ElevenLabs, ZeroGPT để tạo và phân tích transcript.
- **Bảo mật:** Helmet, CORS bật mặc định; app bind 0.0.0.0 cho Docker.
- **Mở rộng:** Code chia module, dễ thêm tính năng mới.

## Cấu trúc thư mục

```
YouTube-Analysis/
├── public/                 # Frontend static
├── services/               # Node.js services (Puppeteer, transcript...)
├── screenshots/            # Ảnh chụp
├── audio/                  # File audio
├── transcripts/            # File transcript JSON
├── Dockerfile              # Docker build
├── docker-compose.yml      # Docker Compose
├── .env.example            # Mẫu biến môi trường
├── package.json            # Node.js dependencies
├── server.js               # Express app chính
└── README.md               # File này
```
