// AHT Fitness server: PocketBase 0.40.5 as a Go app, set up like PocketBase's own standard server
// (examples/base/main.go: pb_hooks, pb_migrations, pb_public), plus one tool for the hooks:
// $webpush (webpush.go) — web-push signing and encryption, which the JS hooks cannot do.
// Everything else (the rules, who gets what, when) stays in pb_hooks/*.js.
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/dop251/goja"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
)

func main() {
	app := pocketbase.New()

	var hooksDir, migrationsDir, publicDir string
	var hooksWatch, automigrate, indexFallback bool
	var hooksPool int
	flags := app.RootCmd.PersistentFlags()
	flags.StringVar(&hooksDir, "hooksDir", "", "the directory with the JS app hooks")
	flags.BoolVar(&hooksWatch, "hooksWatch", true, "auto restart the app on pb_hooks file change")
	flags.IntVar(&hooksPool, "hooksPool", 15, "the total prewarm goja.Runtime instances for the JS app hooks execution")
	flags.StringVar(&migrationsDir, "migrationsDir", "", "the directory with the user defined migrations")
	flags.BoolVar(&automigrate, "automigrate", true, "enable/disable auto migrations")
	flags.StringVar(&publicDir, "publicDir", filepath.Join(os.Args[0], "../pb_public"), "the directory to serve static files")
	flags.BoolVar(&indexFallback, "indexFallback", true, "fallback the request to index.html on missing static path")
	app.RootCmd.ParseFlags(os.Args[1:])

	jsvm.MustRegister(app, jsvm.Config{
		MigrationsDir: migrationsDir,
		HooksDir:      hooksDir,
		HooksWatch:    hooksWatch,
		HooksPoolSize: hooksPool,
		OnInit: func(vm *goja.Runtime) {
			vm.Set("$webpush", map[string]any{
				// $webpush.generateKeys() -> { publicKey, privateKey } (base64url)
				"generateKeys": func() map[string]any {
					pub, priv, err := generateVAPID()
					if err != nil {
						return map[string]any{"error": err.Error()}
					}
					return map[string]any{"publicKey": pub, "privateKey": priv}
				},
				// $webpush.send({ endpoint, p256dh, auth, payload, publicKey, privateKey, subject, ttl, urgency })
				//   -> { status, body, error }
				"send": func(o map[string]any) map[string]any {
					str := func(k string) string { s, _ := o[k].(string); return s }
					ttl := 0
					switch v := o["ttl"].(type) {
					case int64:
						ttl = int(v)
					case float64:
						ttl = int(v)
					case int:
						ttl = v
					}
					status, body, err := send(message{
						Endpoint: str("endpoint"), P256dh: str("p256dh"), Auth: str("auth"),
						Payload: []byte(str("payload")), VAPIDPublic: str("publicKey"), VAPIDPrivate: str("privateKey"),
						Subject: str("subject"), TTL: ttl, Urgency: str("urgency"),
					})
					out := map[string]any{"status": status, "body": body, "error": ""}
					if err != nil {
						out["error"] = err.Error()
					}
					return out
				},
			})
		},
	})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		TemplateLang: migratecmd.TemplateLangJS,
		Automigrate:  automigrate,
		Dir:          migrationsDir,
	})

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), indexFallback))
			}
			return e.Next()
		},
		Priority: 999,
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
