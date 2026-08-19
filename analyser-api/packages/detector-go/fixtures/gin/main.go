package main

import "github.com/gin-gonic/gin"

func getUser(c *gin.Context) {}

func createUser(c *gin.Context) {}

func main() {
	r := gin.Default()

	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	r.GET("/users/:id", getUser)

	auth := r.Group("/admin")
	{
		auth.POST("/users", createUser)
	}
	_ = auth

	r.Run()
}