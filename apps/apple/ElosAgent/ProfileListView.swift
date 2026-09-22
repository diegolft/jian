import ElosKit
import SwiftUI

struct ProfileListView: View {
  @Environment(GatewaySession.self) private var session
  let profiles: [Profile]

  var body: some View {
    List(profiles) { profile in
      VStack(alignment: .leading, spacing: 2) {
        Text(profile.name).font(.headline)
        Text(profile.role).font(.subheadline).foregroundStyle(.secondary)
        Text(subtitle(for: profile))
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
      .padding(.vertical, 2)
    }
    .overlay {
      if profiles.isEmpty {
        ContentUnavailableView("No profiles", systemImage: "person.crop.circle.badge.questionmark")
      }
    }
    .refreshable { await session.refresh() }
    .navigationTitle("Profiles")
    .toolbar {
      Button("Sign Out") { session.signOut() }
    }
  }

  private func subtitle(for profile: Profile) -> String {
    let updated = profile.updatedAt.formatted(date: .abbreviated, time: .shortened)
    return "v\(profile.version) · updated \(updated)"
  }
}
