FROM node:18-slim

RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    openssh-client \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Force git to use HTTPS instead of SSH (fixes Baileys devDep via ssh://git@github.com)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
