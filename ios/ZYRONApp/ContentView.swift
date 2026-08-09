import Foundation
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var controller: ZyronAppController
    @State private var ownerKey = ""
    @State private var picovoiceAccessKey = ""
    @FocusState private var focusedField: Field?

    private enum Field {
        case ownerKey
        case picovoiceKey
    }

    var body: some View {
        ZStack {
            background

            ScrollView {
                VStack(spacing: 18) {
                    header
                    statusCard

                    if controller.isAuthenticated {
                        conversationCard
                        alwaysOnCard
                        acceptanceCard
                        latestReplyCard
                        logoutButton
                    } else {
                        loginCard
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .preferredColorScheme(.dark)
    }

    private var background: some View {
        LinearGradient(
            colors: [
                Color(red: 0.025, green: 0.035, blue: 0.075),
                Color(red: 0.015, green: 0.02, blue: 0.045),
                Color.black,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.cyan.opacity(0.12))
                    .frame(width: 116, height: 116)
                    .blur(radius: 12)

                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [.cyan, .blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 3
                    )
                    .frame(width: 88, height: 88)

                Image(systemName: controller.isConversationRunning ? "waveform" : "circle.hexagongrid.fill")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text("ZYRON")
                    .font(.system(size: 31, weight: .bold, design: .rounded))
                    .tracking(5)
                Text("NATIVE · 0.5.0")
                    .font(.caption2.weight(.semibold))
                    .tracking(2)
                    .foregroundStyle(.cyan.opacity(0.85))
            }
        }
    }

    private var statusCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .shadow(color: statusColor.opacity(0.8), radius: 7)
                .padding(.top, 5)

            Text(controller.statusMessage)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.9))
                .frame(maxWidth: .infinity, alignment: .leading)

            if controller.isBusy {
                ProgressView()
                    .tint(.cyan)
            }
        }
        .zyronCard()
        .accessibilityElement(children: .combine)
    }

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            cardTitle("Conectar este iPhone", icon: "lock.shield.fill")
            Text("La clave se envía una sola vez al backend privado. La app guarda únicamente la sesión resultante en Keychain.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            SecureField("Clave privada del propietario", text: $ownerKey)
                .textContentType(.password)
                .focused($focusedField, equals: .ownerKey)
                .zyronField()

            Button {
                focusedField = nil
                Task {
                    await controller.login(ownerKey: ownerKey)
                    if controller.isAuthenticated {
                        ownerKey = ""
                    }
                }
            } label: {
                Label("Iniciar sesión", systemImage: "arrow.right.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ZyronPrimaryButtonStyle())
            .disabled(controller.isBusy || ownerKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .zyronCard()
    }

    private var conversationCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                cardTitle("Prueba de voz nativa", icon: "mic.fill")
                Spacer()
                Text(controller.responseMode == .audio ? "AUDIO" : "TEXTO")
                    .font(.caption2.bold())
                    .foregroundStyle(controller.responseMode == .audio ? Color.cyan : Color.orange)
            }

            Text("Este botón prueba WebRTC, micrófono y altavoz sin depender todavía de la palabra de activación.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button {
                if controller.isConversationRunning {
                    controller.stopConversation()
                } else {
                    Task { await controller.startManualConversation() }
                }
            } label: {
                Label(
                    controller.isConversationRunning ? "Terminar conversación" : "Hablar con ZYRON",
                    systemImage: controller.isConversationRunning ? "stop.circle.fill" : "waveform.circle.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ZyronPrimaryButtonStyle(danger: controller.isConversationRunning))
            .disabled(controller.isBusy)
        }
        .zyronCard()
    }

    private var alwaysOnCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                cardTitle("Activación por «ZYRON»", icon: "ear.fill")
                Spacer()
                Text(controller.isAlwaysOnEnabled ? "ACTIVA" : "PENDIENTE")
                    .font(.caption2.bold())
                    .foregroundStyle(controller.isAlwaysOnEnabled ? Color.green : Color.secondary)
            }

            Text("Porcupine escucha el nombre dentro del iPhone. El audio ambiente no abre Realtime hasta confirmar una llamada directa.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if controller.isAlwaysOnEnabled {
                Label("Escucha local preparada", systemImage: "checkmark.shield.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)

                Button("Desactivar escucha por nombre") {
                    controller.disableAlwaysOn()
                }
                .buttonStyle(ZyronSecondaryButtonStyle())
                .disabled(controller.isBusy || controller.isConversationRunning)
            } else {
                SecureField(
                    controller.hasStoredPicovoiceKey ? "AccessKey guardada en Keychain" : "Picovoice AccessKey",
                    text: $picovoiceAccessKey
                )
                .textContentType(.password)
                .focused($focusedField, equals: .picovoiceKey)
                .zyronField()

                Button {
                    focusedField = nil
                    Task {
                        await controller.enableAlwaysOn(accessKey: picovoiceAccessKey)
                        if controller.isAlwaysOnEnabled {
                            picovoiceAccessKey = ""
                        }
                    }
                } label: {
                    Label("Preparar escucha local", systemImage: "ear.and.waveform")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ZyronSecondaryButtonStyle())
                .disabled(
                    controller.isBusy
                        || controller.isConversationRunning
                        || (picovoiceAccessKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            && !controller.hasStoredPicovoiceKey)
                )

                Link(destination: URL(string: "https://console.picovoice.ai/")!) {
                    Label("Abrir Picovoice Console", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(.cyan)
            }
        }
        .zyronCard()
    }

    private var acceptanceCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            cardTitle("Gate prioritario", icon: "iphone.gen3.radiowaves.left.and.right")
            acceptanceStep(number: "1", text: "Pulsa «Hablar con ZYRON» y espera a que conecte.")
            acceptanceStep(number: "2", text: "Bloquea el iPhone mientras ZYRON habla.")
            acceptanceStep(number: "3", text: "Habla de nuevo sin desbloquearlo durante al menos 2 minutos.")
        }
        .zyronCard()
    }

    @ViewBuilder
    private var latestReplyCard: some View {
        if !controller.latestText.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                cardTitle("Última respuesta", icon: "text.bubble.fill")
                Text(controller.latestText)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.92))
                    .textSelection(.enabled)
            }
            .zyronCard()
        }
    }

    private var logoutButton: some View {
        Button("Cerrar sesión y borrar claves locales") {
            controller.logout()
            ownerKey = ""
            picovoiceAccessKey = ""
        }
        .font(.footnote)
        .foregroundStyle(.red.opacity(0.85))
        .disabled(controller.isBusy || controller.isConversationRunning)
        .padding(.top, 4)
    }

    private var statusColor: Color {
        if controller.isConversationRunning { return .cyan }
        if controller.isListeningForWakeWord { return .green }
        if controller.isAuthenticated { return .blue }
        return .orange
    }

    private func cardTitle(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            .font(.headline)
            .foregroundStyle(.white)
    }

    private func acceptanceStep(number: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Text(number)
                .font(.caption.bold())
                .foregroundStyle(.black)
                .frame(width: 22, height: 22)
                .background(.cyan, in: Circle())
            Text(text)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.78))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private extension View {
    func zyronCard() -> some View {
        self
            .padding(17)
            .background(
                Color.white.opacity(0.055),
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.09), lineWidth: 1)
            }
    }

    func zyronField() -> some View {
        self
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(Color.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 13))
            .overlay {
                RoundedRectangle(cornerRadius: 13)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            }
    }
}

private struct ZyronPrimaryButtonStyle: ButtonStyle {
    var danger = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(
                danger
                    ? Color.red.opacity(configuration.isPressed ? 0.55 : 0.75)
                    : Color.blue.opacity(configuration.isPressed ? 0.65 : 0.95),
                in: RoundedRectangle(cornerRadius: 15, style: .continuous)
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

private struct ZyronSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.cyan)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Color.cyan.opacity(configuration.isPressed ? 0.08 : 0.13))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.cyan.opacity(0.28), lineWidth: 1)
            }
    }
}

#Preview {
    ContentView()
        .environmentObject(ZyronAppController())
}
