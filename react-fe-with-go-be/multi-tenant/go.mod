module github.com/everscribe/examples/react-fe-with-go-be/multi-tenant

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
