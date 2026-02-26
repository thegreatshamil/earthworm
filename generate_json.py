import json

with open('My workflow (1).json', 'r') as f:
    data = json.load(f)

data['nodes'][1]['parameters']['rules']['values'][0]['conditions']['conditions'][0]['leftValue'] = '={{ $json.body.audio_file ? true : false }}'
data['nodes'][1]['parameters']['rules']['values'][1]['conditions']['conditions'][0]['leftValue'] = '={{ $json.body.image_base64 ? true : false }}'
data['nodes'][2]['parameters']['text'] = '={{ $json.body.text }}'
data['nodes'][4]['parameters']['sessionKey'] = '={{ $json.body.session_id }}'
data['nodes'][6]['parameters']['jsonBody'] = '''={
  "model": "llama-3.2-11b-vision-preview",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "You are Shamil, an expert agricultural AI. Analyze this crop or farm image. Tell the farmer: 1) What you see 2) Any problems like disease, pest, or deficiency 3) What action to take. Be practical and simple. Reply in this language: {{ $json.body.language }}"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,{{ $json.body.image_base64 }}"
          }
        }
      ]
    }
  ],
  "max_tokens": 500
}'''

with open('Earthworm_Agent_Workflow.json', 'w') as f:
    json.dump(data, f, indent=2)

print("Workflow generated successfully.")
