import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Users, ShieldCheck, BarChart3, Database } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-2xl text-primary">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="MysticsHR" className="w-8 h-8" />
            MysticsHR
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/sign-up">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-20 md:py-32 px-4 text-center max-w-4xl mx-auto">
          <Badge className="mb-4 text-sm px-3 py-1 bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            Internal HR Management System
          </Badge>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
            The precise cockpit for <br/>
            <span className="text-primary">HR operations.</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Dense with data, fast to navigate, and precise without being cold. 
            Manage the complete employee lifecycle with operational precision.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-in">
              <Button size="lg" className="w-full sm:w-auto text-lg px-8 h-14">
                Access Dashboard <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 bg-muted/30 px-4">
          <div className="container mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Enterprise-grade capabilities</h2>
              <p className="text-muted-foreground text-lg">Built for precision, scale, and trust.</p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary mb-4">
                  <Database className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Dense Data</h3>
                <p className="text-muted-foreground">Every pixel earns its place. See what you need without endless clicking.</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary mb-4">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Lifecycle Management</h3>
                <p className="text-muted-foreground">From pre-joining to offboarding, handle every transition smoothly.</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary mb-4">
                  <BarChart3 className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Real-time KPIs</h3>
                <p className="text-muted-foreground">Instant visibility into headcount, attrition, and departmental metrics.</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary mb-4">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Role-based Access</h3>
                <p className="text-muted-foreground">Precise control over who sees what, with full audit logging.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-12 bg-background">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>© {new Date().getFullYear()} Automystics Technologies Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${className}`}>
      {children}
    </span>
  );
}
