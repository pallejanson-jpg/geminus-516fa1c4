# Plan: Exempelbilder för AI-mallar ✅ KLAR

## Sammanfattning
Implementerat stöd för exempelbilder i detektionsmallar för att förbättra AI-precision genom "few-shot learning".

## Genomförda ändringar

### 1. Databas
- ✅ Lagt till `example_images TEXT[]` kolumn i `detection_templates`
- ✅ Skapat `template-examples` storage bucket med publika läsrättigheter

### 2. Frontend (TemplateManagement)
- ✅ Ny komponent `ExampleImagesUpload.tsx` för bilduppladdning
- ✅ Visar antal exempelbilder i mallistan
- ✅ Uppladdning till Supabase Storage
- ✅ Max 5 bilder per mall

### 3. Edge Function (ai-asset-detection)
- ✅ Uppdaterat `analyzeImageWithAI()` för few-shot learning
- ✅ Inkluderar exempelbilder i AI-prompten
- ✅ Uppdaterat `createTemplate()` och `updateTemplate()` för example_images

## Teknisk implementation

### Few-shot prompt-struktur
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Here are example images of objects you should look for:" },
    { "type": "text", "text": "Examples of fire_extinguisher (Brandsläckare):" },
    { "type": "image_url", "image_url": { "url": "example1.jpg" } },
    { "type": "image_url", "image_url": { "url": "example2.jpg" } },
    { "type": "text", "text": "Now analyze the following 360° panorama..." },
    { "type": "image_url", "image_url": { "url": "panorama.jpg" } }
  ]
}
```

## Rekommendationer

| Mall | Antal bilder | Tips |
|------|--------------|------|
| Brandsläckare | 3-4 | Olika storlekar, vägg + golv |
| Nödutgång | 2-3 | Olika ljusförhållanden |
| Larmknapp | 2-3 | Med/utan glas, olika märken |
| Brandslang | 2-3 | Skåp + rulle |
