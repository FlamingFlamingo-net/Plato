FROM alpine:3.22

ARG PB_VERSION=0.40.5
ARG TARGETARCH=amd64

RUN apk add --no-cache unzip ca-certificates wget

# Download and unzip PocketBase
RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb/ \
 && rm /tmp/pb.zip

# The app itself (online on Fly these are baked in; locally docker-compose mounts the live folders over them)
COPY ./pb_migrations /pb/pb_migrations
COPY ./pb_hooks /pb/pb_hooks
COPY ./pb_public /pb/pb_public

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
