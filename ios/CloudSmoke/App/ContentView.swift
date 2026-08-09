import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 88))
                Text("ZYRON")
                    .font(.largeTitle.bold())
                Text("Cloud build ready")
                    .font(.headline)
                Text("El Mac ya no es el cuello de botella.")
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding()
        }
    }
}
