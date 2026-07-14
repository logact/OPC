# mosquitto + mosquitto-go-auth 插件（HTTP 后端认证/授权）
# 注意：mosquitto-go-auth 上游已于 2025-06 归档（停更但可用），见 README「已知限制」
FROM golang:1.24-bookworm AS builder

RUN apt-get update && apt-get install -y build-essential git libmosquitto-dev

WORKDIR /src
RUN git clone --depth 1 --branch 3.0.0 https://github.com/iegomez/mosquitto-go-auth.git . \
    && make CFLAGS="-I/usr/include -fPIC"

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y mosquitto && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /mosquitto/config /mosquitto/data && chown -R mosquitto:mosquitto /mosquitto

COPY --from=builder /src/go-auth.so /mosquitto/go-auth.so
COPY mosquitto.conf /mosquitto/config/mosquitto.conf

USER mosquitto
EXPOSE 1883
CMD ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
