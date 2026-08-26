<?php

// Route declarations in Laravel / Slim style.
Route::get('/health', function () {
    return ['ok' => true];
});

Route::post('/users', 'UserController@store');

$app->get('/users/:id', function ($id) {
    return findUser($id);
});

$router->delete('/users/:id', function ($id) {
    deleteUser($id);
});
