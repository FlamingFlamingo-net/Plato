package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func must(t *testing.T, s string) []byte {
	t.Helper()
	b, err := unb64(strings.ReplaceAll(s, " ", ""))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// RFC 8291, section 5 and Appendix A: the published example must come out byte for byte.
func TestRFC8291Example(t *testing.T) {
	asPriv, err := ecdh.P256().NewPrivateKey(must(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	if got := b64.EncodeToString(asPriv.PublicKey().Bytes()); got != "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8" {
		t.Fatalf("as_public: %s", got)
	}
	out, err := encrypt(
		[]byte("When I grow up, I want to be a watermelon"),
		must(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
		must(t, "BTBZMqHH6r4Tts7J_aSIgg"),
		asPriv,
		must(t, "DGv6ra1nlYgDCS1FRnbzlw"),
	)
	if err != nil {
		t.Fatal(err)
	}
	header := must(t, "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8")
	cipherText := must(t, "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ")
	if len(header) != 86 {
		t.Fatalf("header length %d", len(header))
	}
	if got, want := b64.EncodeToString(out), b64.EncodeToString(append(header, cipherText...)); got != want {
		t.Fatalf("result differs from RFC 8291\n got  %s\n want %s", got, want)
	}
}

// decrypt is the receiving side (what a browser does), used to check send() end to end.
func decrypt(t *testing.T, body []byte, uaPriv *ecdh.PrivateKey, auth []byte) []byte {
	t.Helper()
	salt, idlen := body[:16], int(body[20])
	asPub, ct := body[21:21+idlen], body[21+idlen:]
	as, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := uaPriv.ECDH(as)
	info := append(append([]byte("WebPush: info\x00"), uaPriv.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Key(sha256.New, shared, auth, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatal("decrypt:", err)
	}
	if plain[len(plain)-1] != 0x02 {
		t.Fatal("missing padding delimiter")
	}
	return plain[:len(plain)-1]
}

// send() against a fake push service: right headers, a valid VAPID signature, a payload the phone can decrypt.
func TestSendToFakePushService(t *testing.T) {
	uaPriv, _ := ecdh.P256().GenerateKey(nil)
	auth := []byte("0123456789abcdef")
	pub, priv, err := generateVAPID()
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		hdr  http.Header
		body []byte
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.hdr = r.Header.Clone()
		got.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(201)
	}))
	defer srv.Close()

	status, _, err := send(message{
		Endpoint: srv.URL + "/push/abc", P256dh: b64.EncodeToString(uaPriv.PublicKey().Bytes()), Auth: b64.EncodeToString(auth),
		Payload: []byte(`{"kind":"day"}`), VAPIDPublic: pub, VAPIDPrivate: priv, Subject: "https://aht-fitness.fly.dev", TTL: 3600, Urgency: "high",
	})
	if err != nil || status != 201 {
		t.Fatalf("send: %d %v", status, err)
	}
	if got.hdr.Get("Content-Encoding") != "aes128gcm" || got.hdr.Get("TTL") != "3600" || got.hdr.Get("Urgency") != "high" {
		t.Fatalf("headers: %v", got.hdr)
	}
	if string(decrypt(t, got.body, uaPriv, auth)) != `{"kind":"day"}` {
		t.Fatal("payload differs")
	}

	// Authorization: vapid t=<jwt>, k=<public key>; the JWT verifies with k and names the push service's origin.
	a := got.hdr.Get("Authorization")
	if !strings.HasPrefix(a, "vapid t=") || !strings.HasSuffix(a, ", k="+pub) {
		t.Fatalf("authorization: %s", a)
	}
	jwt := strings.TrimSuffix(strings.TrimPrefix(a, "vapid t="), ", k="+pub)
	parts := strings.Split(jwt, ".")
	sig := must(t, parts[2])
	pubKey, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), must(t, pub))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(pubKey, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("VAPID signature does not verify")
	}
	var claims map[string]any
	json.Unmarshal(must(t, parts[1]), &claims)
	if claims["aud"] != srv.URL || claims["sub"] != "https://aht-fitness.fly.dev" {
		t.Fatalf("claims: %v", claims)
	}
	if exp := int64(claims["exp"].(float64)); exp < time.Now().Unix() || exp > time.Now().Add(24*time.Hour).Unix() {
		t.Fatalf("exp out of range: %d", exp)
	}
}

func TestRefusesBadInput(t *testing.T) {
	pub, priv, _ := generateVAPID()
	if _, _, err := send(message{Endpoint: "ftp://x/y", P256dh: pub, Auth: "AAAAAAAAAAAAAAAAAAAAAA", VAPIDPublic: pub, VAPIDPrivate: priv}); err == nil {
		t.Fatal("ftp endpoint accepted")
	}
	if _, _, err := send(message{Endpoint: "https://x/y", P256dh: "bm90LWEta2V5", Auth: "AAAAAAAAAAAAAAAAAAAAAA", VAPIDPublic: pub, VAPIDPrivate: priv}); err == nil {
		t.Fatal("bad p256dh accepted")
	}
}
