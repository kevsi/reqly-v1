use axum::{routing::{get, post}, Router};

async fn health() {}
async fn get_user() {}
async fn create_user() {}

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/users/:id", get(get_user).layer(require_auth))
        .route("/users", post(create_user))
}