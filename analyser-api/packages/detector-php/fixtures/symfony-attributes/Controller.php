<?php

use Symfony\Component\Routing\Attribute\Route;

class UserController {
    #[Route('/health', methods: ['GET'])]
    public function health() {}

    #[Route('/users', methods: ['POST'])]
    public function create() {}

    #[Route('/users/{id}', methods: ['GET'])]
    public function show() {}
}
