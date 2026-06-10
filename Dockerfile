# Signalro — 3D live network traffic visualizer.
# Build:  docker build -t signalro .
# Run:    docker run --rm --net=host --cap-add=NET_RAW --cap-add=NET_ADMIN signalro
#         then open http://localhost:8090
# (--net=host + caps let tcpdump capture the host's traffic on Linux. Without
#  them, or on Docker Desktop, Signalro still runs in simulated demo mode.)
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tcpdump iproute2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./
COPY public ./public
COPY scripts ./scripts
COPY bin ./bin

ENV HOST=0.0.0.0
EXPOSE 8090
CMD ["node", "server.js"]
