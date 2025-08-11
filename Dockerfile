# syntax=docker/dockerfile:1
FROM node:18-slim

# Cài các dependencies hệ thống cho Puppeteer, ffmpeg, yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    python3 \
    python3-pip \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Cài yt-dlp qua pip
RUN pip3 install --break-system-packages yt-dlp

# Tạo thư mục app
WORKDIR /app

# Copy package.json và package-lock.json
COPY package*.json ./

# Cài dependencies Node.js
RUN npm install

# Copy toàn bộ code
COPY . .

# Puppeteer: dùng Chromium hệ thống
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose port
EXPOSE 8080

# Chạy app
CMD ["npm", "start"]
