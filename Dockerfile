FROM node:18-slim

RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    python3 \
    make \
    g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Configure git to use HTTPS AND install — same shell session guarantees git config is active
RUN git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    npm install --legacy-peer-deps --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
