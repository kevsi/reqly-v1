Voici ton parcours de test manuel — chaque fonctionnalité du spec, une par une, avec commandes prêtes et résultats attendus. Tout se fait dans deux terminaux depuis la racine du repo.
Étape 0 — Préparation
Le build est déjà fait. Crée le fichier de démo qui couvre TOUTES les fonctions :

# Terminal 1 — à la racine du repo

mkdir demo-mock; cd demo-mock
Crée demo-mock/mock.config.json avec ce contenu (il expose une route par fonctionnalité) :
{
"version": 1,
"name": "demo-complet",
"port": 4015,
"cors": true,
"routes": [
{
"id": "templated",
"method": "GET",
"path": "/hello/:name",
"responses": [
{ "id": "ok", "statusCode": 200,
"body": "{\"salut\":\"{{request.path.name}}\",\"page\":\"{{request.query.page}}\",\"token\":\"{{request.header.x-api-key}}\",\"uuid\":\"{{uuid}}\"}" }
]
},
{
"id": "generated",
"method": "GET",
"path": "/api/users",
"responses": [
{ "id": "gen", "statusCode": 200,
"schema": { "type": "object",
"properties": {
"email": { "type": "string", "format": "email" },
"nom": { "type": "string", "format": "name" },
"age": { "type": "integer", "min": 18, "max": 99 },
"role": { "type": "string", "enum": ["admin", "user"] },
"tags": { "type": "array", "items": { "type": "string", "format": "slug" }, "minItems": 2, "maxItems": 4 }
}, "required": ["email","nom","age","role","tags"] } }
]
},
{
"id": "conditional",
"method": "POST",
"path": "/pay",
"responses": [
{ "id": "declined", "statusCode": 402,
"rules": [ { "target": "body", "name": "amount", "op": "regex", "value": "^\\d{5,}$" } ],
          "body": "{\"refuse\":true,\"montant\":\"{{request.body.amount}}\"}" },
        { "id": "vip", "statusCode": 200,
          "rules": [ { "target": "header", "name": "x-vip", "op": "equals", "value": "1" } ],
          "body": "{\"vip\":true}" },
        { "id": "default", "statusCode": 200, "body": "{\"ok\":true}" }
      ]
    },
    {
      "id": "slow-route",
      "method": "GET",
      "path": "/lente",
      "responses": [ { "id": "ok", "statusCode": 200, "body": "{\"lente\":true}" } ],
      "latency": { "minMs": 800, "maxMs": 1200 }
    },
    {
      "id": "flaky-500",
      "method": "GET",
      "path": "/instable-500",
      "responses": [ { "id": "ok", "statusCode": 200, "body": "{\"pass\":true}" } ],
      "failure": { "probability": 0.5, "kind": "status", "statusCode": 500 }
    },
    {
      "id": "hang",
      "method": "GET",
      "path": "/timeout",
      "responses": [ { "id": "ok", "statusCode": 200 } ],
      "failure": { "probability": 1, "kind": "timeout", "timeoutMs": 3000 }
    },
    {
      "id": "broken-json",
      "method": "GET",
      "path": "/malformed",
      "responses": [ { "id": "ok", "statusCode": 200 } ],
      "failure": { "probability": 1, "kind": "malformed" }
    },
    {
      "id": "crud-list",
      "method": "GET",
      "path": "/todos/:id",
      "responses": [ { "id": "ok", "statusCode": 200 } ],
      "stateful": { "enabled": true, "resource": "todos" }
    },
    {
      "id": "crud-create",
      "method": "POST",
      "path": "/todos",
      "responses": [ { "id": "created", "statusCode": 201 } ],
      "stateful": { "enabled": true, "resource": "todos" }
    },
    {
      "id": "crud-update",
      "method": "PATCH",
      "path": "/todos/:id",
      "responses": [ { "id": "updated", "statusCode": 200 } ],
      "stateful": { "enabled": true, "resource": "todos" }
    },
    {
      "id": "crud-delete",
      "method": "DELETE",
      "path": "/todos/:id",
      "responses": [ { "id": "gone", "statusCode": 200 } ],
      "stateful": { "enabled": true, "resource": "todos" }
    },
    {
      "id": "transformed",
      "method": "POST",
      "path": "/echo-plus",
      "responses": [ { "id": "ok", "statusCode": 200 } ],
      "transform": "return { recu: body.msg, longueur: String(body.msg ?? '').length, double: (body.n ?? 0) * 2 };"
    }
  ]
}
Étape 1 — Démarrage + hot-reload
Terminal 1 :
node ..\recli\dist\index.js mock start mock.config.json --watch
→ Tu dois voir : ▲ reqly mock serving 12 routes et → http://127.0.0.1:4015 + (watching).
Terminal 2 (tests) — les curls ci-dessous fonctionnent tels quels en PowerShell.
Étape 2 — Les tests, fonctionnalité par fonctionnalité
T1 · Templating (path + query + header + uuid) :
curl.exe -s -H "x-api-key: ma-cle-secrete" "http://127.0.0.1:4015/hello/alex?page=3"
Attendu : "salut":"alex", "page":"3", "token":"ma-cle-secerte"(ta clé), et un UUID différent à chaque appel.
T2 · Données réalistes générées (relance 2-3 fois) :
curl.exe -s http://127.0.0.1:4015/api/users
Attendu : email plausible, nom, age 18-99, role dans admin/user, 2-4 tags — différents à chaque fois.
T3 · Réponses conditionnelles :
curl.exe -s -X POST -H "content-type: application/json" -d "{\"amount\":\"12345\"}" http://127.0.0.1:4015/pay   # → 402 refuse
curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "content-type: application/json" -d "{\"amount\":\"50\"}" http://127.0.0.1:4015/pay   # → 200
curl.exe -s -X POST -H "content-type: application/json" -H "x-vip: 1" -d "{\"amount\":\"50\"}" http://127.0.0.1:4015/pay   # → vip:true (règle header prioritaire)
T4 · Latence :
curl.exe -s -o NUL -w "%{time_total}s`n" http://127.0.0.1:4015/lente
Attendu : ~0.8–1.2 s.
T5 · Pannes probabilistes (×6) :
for ($i=0; $i -lt 6; $i++) { curl.exe -s -o NUL -w "%{http_code} " http://127.0.0.1:4015/instable-500 }
Attendu : mélange 200/500 ≈ 50 %.
T6 · Timeout & JSON malformé :
curl.exe -s --max-time 2 http://127.0.0.1:4015/timeout # → timeout curl (erreur 28)
curl.exe -s http://127.0.0.1:4015/malformed # → {"ok": tronqué/invalide
T7 · CRUD stateful complet :
$cr = curl.exe -s -X POST -H "content-type: application/json" -d "{\"titre\":\"ma tache\"}" http://127.0.0.1:4015/todos
$cr; $id = ($cr | ConvertFrom-Json).id
curl.exe -s http://127.0.0.1:4015/todos/$id                 # → retrouve l'objet
curl.exe -s -X PATCH -H "content-type: application/json" -d "{\"fait\":true}" http://127.0.0.1:4015/todos/$id
curl.exe -s -X DELETE http://127.0.0.1:4015/todos/$id       # → deleted:true
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:4015/todos/$id # → 404
T8 · Transform JS sandboxé :
curl.exe -s -X POST -H "content-type: application/json" -d "{\"msg\":\"salut\",\"n\":21}" http://127.0.0.1:4015/echo-plus
Attendu : {recu:salut, longueur:5, double:42}.
T9 · 501 avec liste des endpoints :
curl.exe -s http://127.0.0.1:4015/nimporte | Select-String available
T10 · Reset du state :
curl.exe -s -X POST http://127.0.0.1:4015/mock/reset
curl.exe -s http://127.0.0.1:4015/todos/tout-ce-que-tu-veux # → reparti à zéro (404)
T11 · Hot-reload : dans mock.config.json, change le texte de /hello puis sauvegarde → Terminal 1 affiche ↻ mock config reloaded → relance T1 sans redémarrer.
T12 · Logs temps réel : observe le Terminal 1 pendant tes appels — chaque requête y apparaît : heure, statut coloré, méthode, route [id], durée ms, note (failure:status) etc.
Dis-moi si un comportement diverge de l'attendu — je corrige. Quand tout est validé de ton côté, on attaque le branchement UI (éditeur + générateur + attach live comme discuté).
