module github.com/everscribe/examples/svelte-fe-with-go-be/single-tenant

go 1.25.0

require (
	github.com/everscribe/sdk-go v0.0.0
	github.com/fuskovic/env v0.0.0
)

require github.com/google/uuid v1.6.0 // indirect

replace (
	github.com/everscribe/sdk-go => ../../../sdk-go
	github.com/fuskovic/env => ../../../../fuskovic/env
)
