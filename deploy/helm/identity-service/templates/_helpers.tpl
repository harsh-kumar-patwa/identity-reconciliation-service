{{- define "identity.labels" -}}
app.kubernetes.io/part-of: identity-service
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end }}

{{- define "identity.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}
{{- end }}

{{- define "identity.databaseUrl" -}}
postgresql://app:$(DB_PASSWORD)@postgres:5432/identity
{{- end }}

{{- define "identity.securityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}
