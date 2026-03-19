FROM node:18-slim

RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    python3 \
    make \
    g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Redirect SSH git URLs to HTTPS (fixes Baileys eslint-config dependency)
RUN git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
