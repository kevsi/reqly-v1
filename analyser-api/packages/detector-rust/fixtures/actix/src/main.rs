use actix_web::{web, HttpResponse};

#[get("/health")]
async fn health() -> HttpResponse {
    HttpResponse::Ok().finish()
}

#[post("/users")]
async fn create_user(web::Json(item): web::Json<NewUser>) -> HttpResponse {
    HttpResponse::Ok().finish()
}

#[route("/users/{id}", method = "get")]
async fn get_user(web::Path(id): web::Path<u32>) -> HttpResponse {
    HttpResponse::Ok().finish()
}

#[middleware(crate::middleware::RequireAuth)]
#[put("/users/{id}")]
async fn update_user(web::Json(item): web::Json<UpdateUser>) -> HttpResponse {
    HttpResponse::Ok().finish()
}