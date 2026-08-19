from flask import Flask, jsonify, request
from functools import wraps

app = Flask(__name__)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        return f(*args, **kwargs)

    return wrapper


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/users", methods=["POST"])
@login_required
def create_user():
    data = request.get_json()
    return jsonify(data)


@app.get("/ping")
def ping():
    return jsonify({"pong": True})