FROM node:20-bookworm-slim

ARG IFCCONVERT_VERSION=0.8.4

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    libgl1 \
    libglu1-mesa \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/ifcconvert.zip \
    "https://github.com/IfcOpenShell/IfcOpenShell/releases/download/ifcconvert-${IFCCONVERT_VERSION}/ifcconvert-${IFCCONVERT_VERSION}-linux64.zip" \
  && unzip -q /tmp/ifcconvert.zip -d /opt/ifcconvert \
  && IFC_BIN_PATH="$(find /opt/ifcconvert -type f -name IfcConvert | head -n 1)" \
  && test -n "${IFC_BIN_PATH}" \
  && chmod +x "${IFC_BIN_PATH}" \
  && ln -s "${IFC_BIN_PATH}" /usr/local/bin/IfcConvert \
  && rm -f /tmp/ifcconvert.zip

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=10000
ENV IFC_CONVERTER_BIN=IfcConvert

EXPOSE 10000

CMD ["node", "server.js"]
