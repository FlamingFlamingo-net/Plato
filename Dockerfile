# AHT Fitness server image.
# Stage 1 compiles PocketBase 0.40.5 as a Go app (main.go + webpush.go: Go standard library only, besides PocketBase
# itself; go.sum pins every module). Stage 2 is the same small Alpine image as before, with the app folders.

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN rm -f *_test.go && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/pocketbase/pocketbase.Version=0.40.5" -o /out/pocketbase .

FROM alpine:3.22
# ca-certificates: the server calls the push services (Google, Apple, Mozilla, Microsoft) over HTTPS.
RUN apk add --no-cache ca-certificates
COPY --from=build /out/pocketbase /pb/pocketbase

# The app itself (online on Fly these are baked in; locally the live folders are mounted over them)
COPY ./pb_migrations /pb/pb_migrations
COPY ./pb_hooks /pb/pb_hooks
COPY ./pb_public /pb/pb_public

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
