# mosquitto + mosquitto-go-auth 插件（HTTP 后端认证/授权）
# 注意：mosquitto-go-auth 上游已于 2025-06 归档（停更但可用），见 README「已知限制」
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache build-base git mosquitto-dev

WORKDIR /src
RUN git clone --depth 1 --branch 3.0.0 https://github.com/iegomez/mosquitto-go-auth.git . \
    && make CFLAGS="-I/usr/include -I/usr/local/include -fPIC -D_GNU_SOURCE -D_LARGEFILE64_SOURCE"

FROM eclipse-mosquitto:2

COPY --from=builder /src/go-auth.so /mosquitto/go-auth.so
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
