// The barcode scanner the pages open through the bridge (scanner.scan()):
// the camera full screen until a code is read or Cancel is tapped. Asks for
// the camera the first time. onDone(code | null).
import { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'

const TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr', 'datamatrix', 'itf14']

export default function Scanner({ onDone }) {
  const [permission, requestPermission] = useCameraPermissions()
  const done = useRef(false)
  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) requestPermission() }, [permission, requestPermission])
  const finish = code => { if (done.current) return; done.current = true; onDone(code) }

  if (!permission) return <View style={s.wrap} />
  if (!permission.granted) {
    return (
      <View style={[s.wrap, s.center]}>
        <Text style={s.text}>Macaroonie Office needs the camera to scan. Allow it in the phone&apos;s settings.</Text>
        <Pressable style={s.button} onPress={() => finish(null)}><Text style={s.buttonText}>Close</Text></Pressable>
      </View>
    )
  }
  return (
    <View style={s.wrap}>
      <CameraView style={StyleSheet.absoluteFill} facing="back"
        barcodeScannerSettings={{ barcodeTypes: TYPES }}
        onBarcodeScanned={({ data }) => { if (data) finish(String(data)) }} />
      <View style={s.frame} pointerEvents="none" />
      <View style={s.bottom}>
        <Text style={s.text}>Point the camera at the barcode.</Text>
        <Pressable style={s.button} onPress={() => finish(null)} accessibilityRole="button">
          <Text style={s.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 10 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  frame: { position: 'absolute', left: '12%', right: '12%', top: '30%', height: '22%', borderColor: '#f4a7b9', borderWidth: 3, borderRadius: 12 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 24, alignItems: 'center', gap: 16 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center' },
  button: { minHeight: 52, minWidth: 160, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  buttonText: { color: '#1f2a44', fontSize: 17, fontWeight: '600' },
})
