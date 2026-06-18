package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

type Job struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func main() {
	apiURL := os.Getenv("JOB_API_URL")
	http.HandleFunc("/sync", func(w http.ResponseWriter, r *http.Request) {
		resp, err := http.Get(apiURL + "/jobs")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		var jobs []Job
		if err := json.NewDecoder(resp.Body).Decode(&jobs); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		log.Printf("synced %d jobs", len(jobs))
		w.WriteHeader(http.StatusAccepted)
	})
	log.Fatal(http.ListenAndServe(":8080", nil))
}
