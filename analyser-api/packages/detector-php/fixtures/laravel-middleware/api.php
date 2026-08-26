<?php

Route::get('/health', function () {
    return ['ok' => true];
});

Route::middleware('auth')->get('/admin', function () {
    return ['admin' => true];
});

$app->post('/users', 'UserController@store');
