{{/*
Generated from:
https://helm.sh/docs/chart_template_guide/named_templates/
*/}}

{{- define "polycentric.labels" -}}
helm.sh/chart: {{ include "polycentric.chart" . }}
{{ include "polycentric.selectorLabels" . }}
{{- end -}}

{{- define "polycentric.selectorLabels" -}}
app.kubernetes.io/name: {{ include "polycentric.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "polycentric.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "polycentric.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end -}}

{{- define "polycentric.chart" -}}
{{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "polycentric.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "polycentric.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end -}}
