const express = require("express");
const app = express();
app.use(express.json());

const auth = require("./middleware/auth");

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/users", auth, (req, res) => {
  const { name } = req.body;
  res.json({ name });
});

app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  const verbose = req.query.verbose;
  res.json({ id });
});

app.patch("/users/:id", auth, (req, res) => {
  res.json(req.body);
});

const router = express.Router();
router.get("/widgets", (req, res) => res.json([]));
app.use("/api", router);

app.listen(3000);
