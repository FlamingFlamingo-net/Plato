// Web push with the Go standard library only:
//   - message encryption: RFC 8291 (ECDH P-256 + HKDF-SHA256) in the aes128gcm content coding of RFC 8188
//   - sender identification: VAPID, RFC 8292 (an ES256-signed JWT)
//
// Keys travel as base64url (the browser's PushSubscription keys and the VAPID key pair).
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const recordSize = 4096

var b64 = base64.RawURLEncoding

func unb64(s string) ([]byte, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "=")
	s = strings.NewReplacer("+", "-", "/", "_").Replace(s)
	return b64.DecodeString(s)
}

// generateVAPID makes a new P-256 key pair: public = 65-byte uncompressed point, private = 32-byte scalar.
func generateVAPID() (pub, priv string, err error) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	return b64.EncodeToString(k.PublicKey().Bytes()), b64.EncodeToString(k.Bytes()), nil
}

// encrypt implements RFC 8291 section 3.4 + RFC 8188 (one record, no padding).
// asKey and salt are parameters so the RFC's example can be checked; send() passes fresh random ones.
func encrypt(plaintext, uaPublic, authSecret []byte, asKey *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(authSecret) != 16 {
		return nil, errors.New("auth secret must be 16 bytes")
	}
	if len(salt) != 16 {
		return nil, errors.New("salt must be 16 bytes")
	}
	if len(plaintext)+1+16 > recordSize {
		return nil, errors.New("payload too large")
	}
	ua, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("bad p256dh key: %w", err)
	}
	shared, err := asKey.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPublic := asKey.PublicKey().Bytes()
	keyInfo := append(append([]byte("WebPush: info\x00"), uaPublic...), asPublic...)
	ikm, err := hkdf.Key(sha256.New, shared, authSecret, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	out.Write(salt)
	binary.Write(&out, binary.BigEndian, uint32(recordSize))
	out.WriteByte(byte(len(asPublic)))
	out.Write(asPublic)
	out.Write(gcm.Seal(nil, nonce, append(append([]byte{}, plaintext...), 0x02), nil))
	return out.Bytes(), nil
}

// vapidJWT signs {aud, exp, sub} with ES256 (RFC 7515 raw r||s signature).
func vapidJWT(audience, subject, privB64 string, exp time.Time) (string, error) {
	raw, err := unb64(privB64)
	if err != nil {
		return "", err
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return "", err
	}
	head := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{"aud": audience, "exp": exp.Unix(), "sub": subject})
	signing := head + "." + b64.EncodeToString(claims)
	sum := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signing + "." + b64.EncodeToString(sig), nil
}

type message struct {
	Endpoint, P256dh, Auth    string
	Payload                   []byte
	VAPIDPublic, VAPIDPrivate string
	Subject                   string
	TTL                       int
	Urgency                   string
}

var client = &http.Client{Timeout: 10 * time.Second}

// send encrypts and posts one message. Returns the push service's HTTP status (201 = accepted; 404/410 = gone).
func send(m message) (int, string, error) {
	u, err := url.Parse(m.Endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return 0, "", errors.New("bad endpoint")
	}
	ua, err := unb64(m.P256dh)
	if err != nil {
		return 0, "", errors.New("bad p256dh")
	}
	auth, err := unb64(m.Auth)
	if err != nil {
		return 0, "", errors.New("bad auth")
	}
	asKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return 0, "", err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return 0, "", err
	}
	body, err := encrypt(m.Payload, ua, auth, asKey, salt)
	if err != nil {
		return 0, "", err
	}
	jwt, err := vapidJWT(u.Scheme+"://"+u.Host, m.Subject, m.VAPIDPrivate, time.Now().Add(12*time.Hour))
	if err != nil {
		return 0, "", fmt.Errorf("vapid: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, m.Endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	ttl := m.TTL
	if ttl < 0 {
		ttl = 0
	}
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", strconv.Itoa(ttl))
	if m.Urgency != "" {
		req.Header.Set("Urgency", m.Urgency)
	}
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+strings.TrimRight(m.VAPIDPublic, "="))
	res, err := client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()
	text, _ := io.ReadAll(io.LimitReader(res.Body, 300))
	return res.StatusCode, string(text), nil
}
