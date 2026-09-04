package main

import (
	"github.com/gin-gonic/gin"
)

func getUser(c *gin.Context)    {}
func createUser(c *gin.Context) {}
func adminPing(c *gin.Context)  {}
func openPing(c *gin.Context)   {}

func jwtAuth(c *gin.Context) {}

func main() {
	r := gin.Default()

	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	r.GET("/users/:id", getUser)

	auth := r.Group("/admin", jwtAuth)
	{
		auth.POST("/users", createUser)
	}

	v1 := r.Group("/api/v1")
	v1.Use(jwtAuth)
	{
		v1.GET("/admin/ping", adminPing)
		open := v1.Group("/open")
		open.GET("/ping", openPing)
	}

	r.Run()
}
